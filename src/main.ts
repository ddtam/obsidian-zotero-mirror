import { Notice, Plugin } from 'obsidian';

import { CollectionExclusions } from './exclusions';
import { HighlightIndex } from './highlights';
import { CitekeyAttachments } from './citekey';
import { HighlightHover } from './hover';
import { ImageFitter } from './imagefit';
import { CitekeyLinkResolver } from './linkfix';
import { releaseDocuments } from './pdfrender';
import { HighlightReferenceInserter } from './picker';
import { PositionIndex } from './positions';
import { ZoteroMirrorSettingTab } from './settings';
import { TrackedIndex } from './tracked';
import {
  DEFAULT_SETTINGS,
  ZoteroIntegrationPlugin,
  ZoteroItemData,
  ZoteroMirrorSettings,
  migrateSettings,
} from './types';
import { ZoteroClient } from './zotero';
import { normaliseMaths } from './normalise';

const INTEGRATION_PLUGIN_ID = 'obsidian-zotero-desktop-connector';

export interface BackfillCandidate {
  citekey: string;
  title: string;
}

export default class ZoteroMirrorPlugin extends Plugin {
  settings!: ZoteroMirrorSettings;
  client!: ZoteroClient;
  tracked!: TrackedIndex;
  positions!: PositionIndex;
  highlights!: HighlightIndex;
  inserter!: HighlightReferenceInserter;
  exclusions!: CollectionExclusions;
  linkResolver!: CitekeyLinkResolver;
  citekeyAttachments!: CitekeyAttachments;
  imageFitter!: ImageFitter;
  hover!: HighlightHover;

  /** citekey -> last time we saw activity (ms). Drained once quiet. */
  private pending = new Map<string, number>();
  /** citekey -> top-level item key, for the pre-import normalise call. */
  private topKeys = new Map<string, string>();
  private pollHandle = 0;
  private polling = false;
  /** citekeys we've already warned about missing-citationKey, to avoid log spam. */
  private warnedNoCitekey = new Set<string>();
  /** excluded-but-tracked citekeys already announced, to avoid Notice spam. */
  private warnedFrozen = new Set<string>();

  lastStatus = 'idle';

  async onload() {
    await this.loadSettings();
    this.client = new ZoteroClient(this.settings.zoteroHost, this.settings.zoteroPort);
    // Holds a getter, not the client itself: applyConnectionSettings replaces
    // the client, and a captured stale one would poll the old host forever.
    this.exclusions = new CollectionExclusions(() => this.client, this.settings);
    this.tracked = new TrackedIndex(this.app, this.settings);
    this.positions = new PositionIndex(this.client, this);
    this.hover = new HighlightHover(this.app, this.settings, this.positions);
    this.highlights = new HighlightIndex(this.app, this.settings, this.tracked);
    this.inserter = new HighlightReferenceInserter(
      this.app,
      this.settings,
      this.highlights,
      this.positions,
    );
    this.linkResolver = new CitekeyLinkResolver(this.app, this.settings, this.tracked);
    this.citekeyAttachments = new CitekeyAttachments(
      this.app,
      this.settings,
      this.tracked,
    );
    this.imageFitter = new ImageFitter(this.app, this.settings, this.tracked);
    this.addSettingTab(new ZoteroMirrorSettingTab(this.app, this));

    // Registered before layout-ready: hovering a zotero:// link needs neither
    // the note index nor Zotero running, only last session's cached geometry.
    this.hover.registerEvents(this);
    void this.positions.loadCache();

    this.addCommand({
      id: 'insert-highlight-reference',
      name: 'Insert highlight reference',
      callback: () => void this.inserter.run(),
    });

    this.addCommand({
      id: 'insert-highlight-embed',
      name: 'Insert highlight embed',
      callback: () => void this.inserter.runEmbed(),
    });

    // Wait for the metadata cache to be populated before indexing notes.
    this.app.workspace.onLayoutReady(async () => {
      this.tracked.rebuild();
      // Registration order matters: the tracked index must absorb a note's
      // change before the resolver tries to look citekeys up in it.
      this.tracked.registerEvents(this);
      this.highlights.registerEvents(this);
      this.linkResolver.registerEvents(this);
      this.imageFitter.registerEvents(this);
      await this.ensureBaseline();
      this.restartPolling();
      void this.tick(); // immediate catch-up for anything annotated while closed
      // Warm the highlight geometry so the first hover is instant, and refresh
      // the on-disk cache that keeps previews working once Zotero is closed.
      void this.positions.ensure();
    });
  }

  onunload() {
    if (this.pollHandle) window.clearInterval(this.pollHandle);
    // Parsed PDFs can be tens of MB each; do not leave them to the GC.
    releaseDocuments();
  }

  // ---- settings plumbing -------------------------------------------------

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (migrateSettings(this.settings)) await this.saveSettings();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** Re-create the API client after host/port changes. */
  /**
   * The `zotero://open-pdf` link for a citekey, or null.
   *
   * Public API, for other plugins. Dendrite draws each citation in a
   * manuscript as a link to its paper's PDF so this plugin's hover can
   * preview it, and most cited papers have no literature note, so the note
   * index alone cannot answer. Returns the whole link rather than a bare
   * key, since a group library's link names the library and the key alone
   * cannot. Resolution order and caching are in `CitekeyAttachments`.
   */
  pdfLinkFor(citekey: string): Promise<string | null> {
    return this.citekeyAttachments.linkFor(citekey);
  }

  applyConnectionSettings() {
    this.client = new ZoteroClient(this.settings.zoteroHost, this.settings.zoteroPort);
    // Answers were resolved against the old Zotero, and a cached hit would
    // outlive the host it came from.
    this.citekeyAttachments.forget();
    // The position cache holds a client of its own; a stale one would keep
    // talking to the old host. Everything holding a reference to it has to be
    // rebuilt too, or the hover previews keep reading the old index.
    this.positions = new PositionIndex(this.client, this);
    void this.positions.loadCache();
    this.inserter = new HighlightReferenceInserter(
      this.app,
      this.settings,
      this.highlights,
      this.positions,
    );
    this.hover.setPositions(this.positions);
  }

  restartPolling() {
    if (this.pollHandle) window.clearInterval(this.pollHandle);
    const ms = Math.max(5, this.settings.pollIntervalSeconds) * 1000;
    this.pollHandle = window.setInterval(() => void this.tick(), ms);
    this.registerInterval(this.pollHandle);
  }

  // ---- the loop ----------------------------------------------------------

  /** On first ever run, baseline to the current version so the historical
   *  annotation backlog is ignored. Also self-heals if baseline never ran. */
  private async ensureBaseline(): Promise<boolean> {
    if (this.settings.lastLibraryVersion > 0) return true;
    if (!(await this.client.isReachable())) return false;
    this.settings.lastLibraryVersion = await this.client.getCurrentVersion();
    await this.saveSettings();
    return true;
  }

  private async tick() {
    if (!this.settings.enabledOnThisDevice) return;
    try {
      await this.poll();
      await this.flushQuiet();
    } catch (e) {
      console.error('[zotero-mirror] tick failed', e);
      this.lastStatus = `error: ${(e as Error).message}`;
    }
  }

  private async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      if (!(await this.client.isReachable())) {
        this.lastStatus = 'Zotero not reachable';
        return;
      }
      // Never process from version 0 — that would mass-import the whole library.
      if (this.settings.lastLibraryVersion === 0) {
        await this.ensureBaseline();
        return;
      }

      // Resolve exclusions before processing. On a cold-start failure the
      // cycle is skipped WITHOUT advancing the library version: importing an
      // excluded item once would let REFRESH keep it fresh forever, and
      // skipping items while advancing would drop legitimate imports for good.
      if (!(await this.exclusions.refreshIfStale())) {
        this.lastStatus = 'exclusions unresolved; retrying';
        return;
      }

      this.client.resetCache();
      const { items, newVersion } = await this.client.getChangedSince(
        this.settings.lastLibraryVersion,
      );

      for (const item of items) {
        await this.consider(item);
      }

      if (newVersion > this.settings.lastLibraryVersion) {
        this.settings.lastLibraryVersion = newVersion;
        await this.saveSettings();
      }
      this.lastStatus = `ok @ v${this.settings.lastLibraryVersion}, ${this.pending.size} pending`;
    } finally {
      this.polling = false;
    }
  }

  /** Decide whether a changed item should (eventually) trigger an import. */
  private async consider(item: ZoteroItemData) {
    // The poll already carries every changed annotation, so keeping highlight
    // geometry current costs nothing extra here.
    this.positions.absorb(item);

    const top = await this.client.resolveTopLevel(item);
    if (!top) return;

    const citekey = top.citationKey?.replace(/^@/, '').trim();
    if (!citekey) {
      if (!this.warnedNoCitekey.has(top.key)) {
        this.warnedNoCitekey.add(top.key);
        console.warn(`[zotero-mirror] no citationKey for item ${top.key}; skipping`);
      }
      return;
    }

    // Exclusion beats every branch below, REFRESH included -- that branch has
    // no other guard and would otherwise keep an excluded item's note fresh
    // forever. An excluded item that already has a note freezes in place; say
    // so once, so the stray note gets noticed and deleted rather than
    // discovered months later.
    if (this.exclusions.isExcludedItem(top)) {
      if (this.tracked.has(citekey) && !this.warnedFrozen.has(citekey)) {
        this.warnedFrozen.add(citekey);
        console.warn(
          `[zotero-mirror] ${citekey} is in an excluded collection; its note is frozen`,
        );
        new Notice(
          `Zotero Mirror: "${citekey}" is in an excluded collection — its note will no longer update. Delete it if unwanted.`,
          10000,
        );
      }
      return;
    }

    const isAnnotation = item.itemType === 'annotation';
    const typeAllowed = this.settings.allowedItemTypes.includes(top.itemType);

    if (this.tracked.has(citekey)) {
      this.enqueue(citekey, top.key); // REFRESH — note exists, keep it fresh regardless of type
    } else if (isAnnotation && typeAllowed) {
      this.enqueue(citekey, top.key); // ENRICH — annotating a new in-scope paper (journal-only)
    } else if (this.hasTriggerTag(top.tags)) {
      // STUB — a deliberate status/priority tag is an explicit "track this" signal,
      // so it imports ANY item type (book, report, etc.), unlike the annotation path.
      this.enqueue(citekey, top.key);
    }
  }

  private hasTriggerTag(tags?: ZoteroItemData['tags']): boolean {
    if (!tags?.length) return false;
    return tags.some((t) => this.settings.stubTriggerTags.includes(t.tag));
  }

  private enqueue(citekey: string, topKey?: string) {
    this.pending.set(citekey, Date.now());
    // Kept so the import can name the item to Zotero Automations, which knows
    // keys and not citekeys. Only ever set from a resolved top-level item.
    if (topKey) this.topKeys.set(citekey, topKey);
  }

  /** Import every pending paper that has been quiet for the cooldown. */
  private async flushQuiet() {
    const now = Date.now();
    const cooldownMs = this.settings.quietCooldownSeconds * 1000;
    for (const [citekey, lastSeen] of [...this.pending]) {
      if (now - lastSeen >= cooldownMs) {
        this.pending.delete(citekey);
        await this.importOne(citekey);
      }
    }
  }

  // ---- importing ---------------------------------------------------------

  getIntegration(): ZoteroIntegrationPlugin | null {
    const p = (this.app as any).plugins?.plugins?.[INTEGRATION_PLUGIN_ID];
    return p && typeof p.runImport === 'function' ? (p as ZoteroIntegrationPlugin) : null;
  }

  async importOne(citekey: string): Promise<boolean> {
    // Choke point: every import path funnels through here, so a stale pending
    // entry or a bypass path cannot slip an excluded item through.
    if (this.exclusions.isExcludedCitekey(citekey)) return false;
    const zi = this.getIntegration();
    if (!zi) {
      new Notice('Zotero Mirror: "Zotero Integration" plugin not found / no runImport.');
      return false;
    }
    // Before the note is written, give Zotero a chance to settle this item's
    // maths highlights. Fails open in every case, including the plugin not
    // being installed, so an import is never blocked by it.
    if (this.settings.normaliseMathsBeforeImport) {
      const key = this.topKeys.get(citekey);
      if (key) {
        const result = await normaliseMaths(
          this.settings.zoteroHost,
          this.settings.zoteroPort,
          key,
        );
        if (result?.changed) {
          console.log(
            `[zotero-mirror] normalised maths in ${result.changed} annotation(s) of ${citekey}`,
          );
        }
      }
    }
    try {
      await zi.runImport(this.settings.exportFormatName, citekey, this.settings.libraryId);
      return true;
    } catch (e) {
      console.error(`[zotero-mirror] import failed for ${citekey}`, e);
      new Notice(`Zotero Mirror: import failed for ${citekey} (see console).`);
      return false;
    }
  }

  // ---- actions used by the settings tab ----------------------------------

  /** Force one poll + flush now (manual button / verification). */
  async forceSync() {
    this.exclusions.invalidate(); // pick up settings edits immediately
    this.client.resetCache();
    await this.poll();
    await this.flushQuiet();
  }

  /** Re-baseline to the current library version (forget the backlog). */
  async resetBaseline() {
    if (!(await this.client.isReachable())) {
      new Notice('Zotero Mirror: Zotero not reachable.');
      return;
    }
    this.settings.lastLibraryVersion = await this.client.getCurrentVersion();
    await this.saveSettings();
    new Notice(`Zotero Mirror: baseline reset to v${this.settings.lastLibraryVersion}.`);
  }

  /** Tagged items of ANY type (matching the tag path) that do NOT yet have a note. */
  async collectBackfill(): Promise<BackfillCandidate[]> {
    const out: BackfillCandidate[] = [];
    const seen = new Set<string>();
    await this.exclusions.refreshIfStale();
    const items = await this.client.getTaggedItems(this.settings.stubTriggerTags);
    for (const it of items) {
      if (this.exclusions.isExcludedItem(it)) continue;
      // citationKey is present only on top-level regular items (not attachments/
      // notes/annotations), so it doubles as the "importable item" filter.
      const citekey = it.citationKey?.replace(/^@/, '').trim();
      if (!citekey || seen.has(citekey)) continue;
      seen.add(citekey);
      if (this.tracked.has(citekey)) continue;
      out.push({ citekey, title: it.title ?? citekey });
    }
    return out;
  }

  /**
   * Every tracked paper, for re-importing in place.
   *
   * Needed because block anchors were added to the template after most notes
   * were already imported: those notes have no `^annotationKey` to reference
   * until they are rendered again.
   */
  collectTracked(): BackfillCandidate[] {
    return this.tracked
      .citekeys()
      .filter((citekey) => !this.exclusions.isExcludedCitekey(citekey))
      .map((citekey) => ({
        citekey,
        title: this.tracked.fileFor(citekey)?.basename ?? citekey,
      }));
  }

  /** Import a list throttled to avoid a LiveSync revision storm. */
  async runBackfill(
    list: BackfillCandidate[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<number> {
    let done = 0;
    for (const c of list) {
      const ok = await this.importOne(c.citekey);
      if (ok) done++;
      onProgress?.(done, list.length);
      await sleep(400); // ~2.5 imports/sec
    }
    return done;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
