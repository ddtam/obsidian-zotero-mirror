import { Plugin } from 'obsidian';

import { AnnotationPosition, ZoteroItemData } from './types';
import { ZoteroClient } from './zotero';

/** Kept beside the plugin, not in data.json: thousands of entries would bloat
 *  settings, and this is a rebuildable cache rather than configuration. */
const CACHE_FILE = 'positions.json';

/** How long to wait before retrying after Zotero could not be reached. */
const RETRY_COOLDOWN_MS = 60_000;

/**
 * Where each Zotero annotation sits in its PDF.
 *
 * The notes themselves cannot answer this. Their `[pg N]` text is the page
 * *printed* on the paper -- for a journal article that is something like 2213
 * while the annotation is on physical page 5 -- so a PDF link built from the
 * markdown would point into empty space. The API's `pageIndex` is the physical
 * page, and it is the only trustworthy source.
 *
 * Held in memory only. It is a cache of something Zotero already owns, so
 * persisting it would just create a second thing that can be stale.
 */
export class PositionIndex {
  private byAnnotation = new Map<string, AnnotationPosition>();
  private loaded = false;
  private loading: Promise<boolean> | null = null;
  private dirty = false;
  private lastFailure = 0;

  constructor(
    private client: ZoteroClient,
    private plugin?: Plugin,
  ) {}

  /**
   * Load the cache written by a previous session.
   *
   * Hover previews have to work with Zotero closed — that is the common case
   * while writing — and geometry only reaches us through Zotero's API, so
   * without this the feature would silently depend on Zotero running.
   */
  async loadCache(): Promise<void> {
    if (!this.plugin) return;
    const path = `${this.plugin.manifest.dir}/${CACHE_FILE}`;
    try {
      const adapter = this.plugin.app.vault.adapter;
      if (!(await adapter.exists(path))) return;
      const raw = JSON.parse(await adapter.read(path)) as Record<
        string,
        AnnotationPosition
      >;
      for (const [key, value] of Object.entries(raw)) {
        if (value && typeof value.pageIndex === 'number') this.byAnnotation.set(key, value);
      }
    } catch (e) {
      console.warn('[zotero-mirror] could not read the position cache', e);
    }
  }

  /** Persist, if anything changed since the last write. */
  async saveCache(): Promise<void> {
    if (!this.plugin || !this.dirty) return;
    this.dirty = false;
    const path = `${this.plugin.manifest.dir}/${CACHE_FILE}`;
    try {
      await this.plugin.app.vault.adapter.write(
        path,
        JSON.stringify(Object.fromEntries(this.byAnnotation)),
      );
    } catch (e) {
      console.warn('[zotero-mirror] could not write the position cache', e);
    }
  }

  get(annotationKey: string): AnnotationPosition | undefined {
    return this.byAnnotation.get(annotationKey);
  }

  size(): number {
    return this.byAnnotation.size;
  }

  /**
   * Load the whole library's annotation geometry, once per session.
   *
   * Returns false when Zotero is unreachable — callers fall back to note-block
   * links rather than failing, so a closed Zotero degrades the output instead of
   * breaking the command.
   */
  async ensure(): Promise<boolean> {
    if (this.loaded) return true;
    // Hover previews call this, so a closed Zotero must fail fast. Without a
    // cooldown every hover would wait out the request timeout again.
    if (Date.now() - this.lastFailure < RETRY_COOLDOWN_MS) return false;
    // Concurrent callers share one fetch rather than racing to build the map.
    if (!this.loading) {
      this.loading = this.load().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  private async load(): Promise<boolean> {
    try {
      const items = await this.client.getAllAnnotations();
      for (const item of items) this.absorb(item);
      this.loaded = true;
      await this.saveCache();
      return true;
    } catch (e) {
      console.error('[zotero-mirror] failed to load annotation positions', e);
      this.lastFailure = Date.now();
      return false;
    }
  }

  /**
   * Record one annotation's position.
   *
   * Called both by the initial load and from the poll loop, which already sees
   * every changed annotation — so edits stay current for free, with no second
   * request and no invalidation logic.
   */
  absorb(item: ZoteroItemData): void {
    if (item.itemType !== 'annotation') return;
    const position = parsePosition(item.annotationPosition);
    if (!position || !item.parentItem) return;
    this.dirty = true;
    this.byAnnotation.set(item.key, {
      // An annotation's parent is the attachment, whose key is also the name of
      // its folder under ~/Zotero/storage — which is how a highlight finds its
      // PDF file with no filesystem access.
      attachmentKey: item.parentItem,
      pageIndex: position.pageIndex,
      rects: position.rects,
      color: item.annotationColor,
    });
  }
}

function parsePosition(raw: string | undefined): { pageIndex: number; rects: number[][] } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { pageIndex?: unknown; rects?: unknown };
    const pageIndex = typeof parsed.pageIndex === 'number' ? parsed.pageIndex : null;
    if (pageIndex === null) return null;
    const rects = Array.isArray(parsed.rects)
      ? parsed.rects.filter((r): r is number[] => Array.isArray(r) && r.length >= 4)
      : [];
    return { pageIndex, rects };
  } catch {
    return null;
  }
}
