export interface ZoteroMirrorSettings {
  /** Only the device with this flag set actually polls + imports. Prevents
   *  multiple LiveSync'd devices from racing to write the same note. */
  enabledOnThisDevice: boolean;

  /** Name of the Zotero Integration export format to drive (must exist in that plugin). */
  exportFormatName: string;

  /** Zotero local API host/port. */
  zoteroHost: string;
  zoteroPort: number;

  /** BBT/Zotero library id passed to runImport (1 = personal "My Library"). */
  libraryId: number;

  /** How often to poll Zotero for changes, in seconds. */
  pollIntervalSeconds: number;

  /** A paper is imported only once it has had no further changes for this long.
   *  Batches a reading-session burst of highlights into a single note write. */
  quietCooldownSeconds: number;

  /** Item types eligible for *annotation-triggered* new notes (journal-only by
   *  default). Tag-triggered imports and updates to existing notes ignore this. */
  allowedItemTypes: string[];

  /** Tags that flag an item (ANY type) for import — a discoverability stub. */
  stubTriggerTags: string[];

  /** Vault-relative folder whose notes' `citekey` frontmatter marks tracked papers. */
  sourceFolder: string;

  /** Frontmatter property holding the Better BibTeX citekey. */
  citekeyProperty: string;

  /** Persisted Zotero library version last processed. */
  lastLibraryVersion: number;
}

export const DEFAULT_SETTINGS: ZoteroMirrorSettings = {
  enabledOnThisDevice: false,
  exportFormatName: 'Smart Import',
  zoteroHost: '127.0.0.1',
  zoteroPort: 23119,
  libraryId: 1,
  pollIntervalSeconds: 45,
  quietCooldownSeconds: 90,
  allowedItemTypes: ['journalArticle'],
  stubTriggerTags: ['📚️', '📖', '✅', '🔴', '🟡', '🔵'],
  sourceFolder: '2 - Source Material',
  citekeyProperty: 'citekey',
  lastLibraryVersion: 0,
};

/** Minimal shape of a Zotero API item's `data` block (only fields we read). */
export interface ZoteroItemData {
  key: string;
  version: number;
  itemType: string;
  parentItem?: string;
  citationKey?: string;
  title?: string;
  tags?: Array<{ tag: string; type?: number }>;
}

/** The Zotero Integration plugin instance, narrowed to the method we call. */
export interface ZoteroIntegrationPlugin {
  runImport(name: string, citekey: string, library?: number): Promise<void>;
  settings?: { exportFormats?: Array<{ name: string }> };
}
