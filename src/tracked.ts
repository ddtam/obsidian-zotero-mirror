import { App, CachedMetadata, Plugin, TAbstractFile, TFile } from 'obsidian';

import { ZoteroMirrorSettings } from './types';

/**
 * Index of citekeys that already have a note in the source folder.
 * A note existing for a citekey is the user's opt-in to "track this item":
 * such notes are refreshed on any Zotero change, regardless of item type.
 */
export class TrackedIndex {
  private citekeys = new Set<string>();

  constructor(
    private app: App,
    private settings: ZoteroMirrorSettings,
  ) {}

  has(citekey: string): boolean {
    return this.citekeys.has(citekey);
  }

  size(): number {
    return this.citekeys.size;
  }

  private inScope(file: TAbstractFile): file is TFile {
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
    this.citekeys.clear();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.inScope(file)) continue;
      const key = this.citekeyOf(this.app.metadataCache.getFileCache(file));
      if (key) this.citekeys.add(key);
    }
  }

  /** Keep the index current as notes are written, deleted, or moved. */
  registerEvents(plugin: Plugin): void {
    plugin.registerEvent(
      this.app.metadataCache.on('changed', (file, _data, cache) => {
        if (!this.inScope(file)) return;
        const key = this.citekeyOf(cache);
        if (key) this.citekeys.add(key);
      }),
    );
    // Deletes/renames are rare; a full rebuild keeps the set exact (a citekey
    // can be removed without us knowing which file it belonged to).
    plugin.registerEvent(this.app.vault.on('delete', () => this.rebuild()));
    plugin.registerEvent(this.app.vault.on('rename', () => this.rebuild()));
  }
}
