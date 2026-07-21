import { AnnotationPosition, ZoteroItemData } from './types';
import { ZoteroClient } from './zotero';

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

  constructor(private client: ZoteroClient) {}

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
      return true;
    } catch (e) {
      console.error('[zotero-mirror] failed to load annotation positions', e);
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
