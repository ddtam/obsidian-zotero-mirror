import { App, CachedMetadata, Plugin, TAbstractFile, TFile } from 'obsidian';

import { ZoteroMirrorSettings } from './types';

/**
 * Index of citekeys that already have a note in the source folder.
 * A note existing for a citekey is the user's opt-in to "track this item":
 * such notes are refreshed on any Zotero change, regardless of item type.
 */
export class TrackedIndex {
  /** Citekey -> the note that declares it. The note is needed to build links
   *  back to it, so this is a map rather than the set it started as. */
  private byCitekey = new Map<string, TFile>();

  constructor(
    private app: App,
    private settings: ZoteroMirrorSettings,
  ) {}

  has(citekey: string): boolean {
    return this.byCitekey.has(citekey);
  }

  size(): number {
    return this.byCitekey.size;
  }

  /** The note for a citekey, if one is tracked. */
  fileFor(citekey: string): TFile | undefined {
    return this.byCitekey.get(citekey);
  }

  /** Every tracked citekey, for sweeps and backfills. */
  citekeys(): string[] {
    return [...this.byCitekey.keys()];
  }

  /** True for markdown notes inside the configured source folder. */
  isSourceNote(file: TAbstractFile): file is TFile {
    return (
      file instanceof TFile &&
      file.extension === 'md' &&
      (file.path === this.settings.sourceFolder ||
        file.path.startsWith(this.settings.sourceFolder + '/'))
    );
  }

  private citekeyOf(cache: CachedMetadata | null): string | null {
    const raw = cache?.frontmatter?.[this.settings.citekeyProperty];
    if (raw === undefined || raw === null) return null;
    const key = String(raw).trim();
    return key ? key.replace(/^@/, '') : null;
  }

  /** Full rebuild from the metadata cache. */
  rebuild(): void {
    this.byCitekey.clear();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.isSourceNote(file)) continue;
      const key = this.citekeyOf(this.app.metadataCache.getFileCache(file));
      if (key) this.byCitekey.set(key, file);
    }
  }

  /** Keep the index current as notes are written, deleted, or moved. */
  registerEvents(plugin: Plugin): void {
    plugin.registerEvent(
      this.app.metadataCache.on('changed', (file, _data, cache) => {
        if (!this.isSourceNote(file)) return;
        const key = this.citekeyOf(cache);
        if (key) this.byCitekey.set(key, file);
      }),
    );
    // Deletes/renames are rare; a full rebuild keeps the set exact (a citekey
    // can be removed without us knowing which file it belonged to).
    plugin.registerEvent(this.app.vault.on('delete', () => this.rebuild()));
    plugin.registerEvent(this.app.vault.on('rename', () => this.rebuild()));
  }
}
