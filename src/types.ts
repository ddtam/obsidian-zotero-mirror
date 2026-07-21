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

  /** Zotero's data directory — attachments are read from `<dir>/storage/<key>/`.
   *  Read directly from disk, so no PDF ever enters the vault. */
  zoteroDataDir: string;

  /** Render a PDF page preview when hovering a `zotero://open-pdf` link. */
  hoverPreviews: boolean;

  /** Require ctrl/cmd to be held for the preview to appear. */
  hoverRequiresModKey: boolean;

  /** Render scale. Higher is sharper and slower. */
  hoverPopoverScale: number;

  /** Visible height of the scrollable preview, in pixels. */
  hoverPopoverHeight: number;

  /** Inserted when a highlight's PDF and position are both resolvable. */
  highlightInsertTemplate: string;

  /** Inserted otherwise — no `pdfFolder`, Zotero closed, non-PDF attachment,
   *  or an annotation with no usable geometry. */
  highlightFallbackTemplate: string;
}

/**
 * A `zotero://` link rather than a wikilink, deliberately: Obsidian has no
 * native preview for a custom protocol, so the plugin's PDF popover is
 * uncontested, and clicking already opens Zotero at the annotation with no code
 * at all. It is also the exact form every imported highlight's `[pg N]` backlink
 * already uses, so previews work in existing notes without relinking.
 */
export const DEFAULT_INSERT_TEMPLATE =
  '[in](zotero://open-pdf/library/items/{{attachment}}?page={{page}}&annotation={{key}}) [[{{note}}|{{cite}}]]';

/** Used when Zotero has never been reached, so no attachment key is known.
 *  Previews the imported text instead of the PDF, and works on mobile. */
export const DEFAULT_FALLBACK_TEMPLATE = '[[{{note}}#^{{key}}|in]] [[{{note}}|{{cite}}]]';

/** Superseded defaults, replaced in place by migrateSettings. */
const LEGACY_TEMPLATES = [
  // 0.3.0–0.3.1, italicised.
  '_[[{{pdf}}#page={{page}}&rect={{rect}}&color={{color}}|in]]_ _[[{{note}}|{{cite}}]]_',
  // 0.3.2–0.3.3, PDF++ links against a symlinked vault folder.
  '[[{{pdf}}#page={{page}}&rect={{rect}}&color={{color}}|in]] [[{{note}}|{{cite}}]]',
];
const LEGACY_FALLBACK_TEMPLATE = '_[[{{note}}#^{{key}}|in]]_ _[[{{note}}|{{cite}}]]_';

/**
 * Bring forward settings that were persisted with a superseded default.
 *
 * Defaults only apply to keys absent from data.json, and saving any setting
 * writes them all — so a default that shipped once is stuck on every install
 * that has ever opened the settings tab. Only an exactly-unmodified value is
 * replaced; a template the user has edited is theirs.
 *
 * Returns true if anything changed, so the caller can persist it.
 */
export function migrateSettings(settings: ZoteroMirrorSettings): boolean {
  let changed = false;
  if (LEGACY_TEMPLATES.includes(settings.highlightInsertTemplate)) {
    settings.highlightInsertTemplate = DEFAULT_INSERT_TEMPLATE;
    changed = true;
  }
  if (settings.highlightFallbackTemplate === LEGACY_FALLBACK_TEMPLATE) {
    settings.highlightFallbackTemplate = DEFAULT_FALLBACK_TEMPLATE;
    changed = true;
  }
  return changed;
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
  resolveCitekeyLinks: false,
  zoteroDataDir: `${process.env.HOME ?? '~'}/Zotero`,
  hoverPreviews: true,
  hoverRequiresModKey: false,
  hoverPopoverScale: 1.5,
  hoverPopoverHeight: 420,
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
