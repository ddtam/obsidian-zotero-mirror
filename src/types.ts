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

  /** Rewrite bare `[[citekey]]` links in source notes into links that resolve.
   *  Off by default: it edits notes, which the rest of the plugin only does via
   *  Zotero Integration. */
  resolveCitekeyLinks: boolean;

  /** Vault folder holding Zotero's PDFs (typically a symlink to
   *  `~/Zotero/storage`). **Empty by default**, which is the whole gate on the
   *  PDF tier: empty means highlight references link to the note's own block
   *  anchor, needing no PDFs in the vault at all. Setting it switches them to
   *  `file.pdf#page=N&rect=…` links — do NOT set it before excluding the folder
   *  from LiveSync, or the PDFs replicate to the remote. */
  pdfFolder: string;

  /** Inserted when a highlight's PDF and position are both resolvable. */
  highlightInsertTemplate: string;

  /** Inserted otherwise — no `pdfFolder`, Zotero closed, non-PDF attachment,
   *  or an annotation with no usable geometry. */
  highlightFallbackTemplate: string;
}

export const DEFAULT_INSERT_TEMPLATE =
  '_[[{{pdf}}#page={{page}}&rect={{rect}}&color={{color}}|in]]_ _[[{{note}}|{{cite}}]]_';

export const DEFAULT_FALLBACK_TEMPLATE = '_[[{{note}}#^{{key}}|in]]_ _[[{{note}}|{{cite}}]]_';

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
  resolveCitekeyLinks: false,
  pdfFolder: '',
  highlightInsertTemplate: DEFAULT_INSERT_TEMPLATE,
  highlightFallbackTemplate: DEFAULT_FALLBACK_TEMPLATE,
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

  // Annotation items only. `annotationPosition` is a JSON *string*:
  //   {"pageIndex":4,"rects":[[68.75,131.95,257.2,139.36], …]}
  // pageIndex is 0-based and is the physical page; annotationPageLabel is the
  // page *printed* on the paper (often a journal page like "2213") and must
  // never be used to build a PDF link.
  annotationPosition?: string;
  annotationColor?: string;
  annotationPageLabel?: string;
}

/** Parsed `annotationPosition`, joined to its attachment. */
export interface AnnotationPosition {
  /** The attachment item key — also the `~/Zotero/storage/<key>/` folder name. */
  attachmentKey: string;
  /** 0-based; PDF links need `pageIndex + 1`. */
  pageIndex: number;
  /** One rect per line of the highlight, `[x0,y0,x1,y1]` in PDF user space. */
  rects: number[][];
  color?: string;
}

/** The Zotero Integration plugin instance, narrowed to the method we call. */
export interface ZoteroIntegrationPlugin {
  runImport(name: string, citekey: string, library?: number): Promise<void>;
  settings?: { exportFormats?: Array<{ name: string }> };
}
