import { App, FuzzyMatch, FuzzySuggestModal, Notice, TFile } from 'obsidian';

import { HighlightEntry, HighlightIndex, displayText } from './highlights';
import { PositionIndex } from './positions';
import { formatRect, groupedRect } from './rects';
import { ZoteroMirrorSettings } from './types';

/**
 * Inserting a reference to a specific Zotero highlight.
 *
 * Produces two links: one whose hover shows the highlight in context, and one to
 * the source note. Which form the first takes depends on `pdfFolder` — see
 * buildReference.
 */
export class HighlightReferenceInserter {
  constructor(
    private app: App,
    private settings: ZoteroMirrorSettings,
    private highlights: HighlightIndex,
    private positions: PositionIndex,
  ) {}

  /** Prompt for a highlight and insert a reference to it at the cursor. */
  async run(): Promise<void> {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) {
      new Notice('Zotero Mirror: open a note to insert into first.');
      return;
    }
    const entries = await this.highlights.all();
    if (entries.length === 0) {
      new Notice(
        'Zotero Mirror: no highlights found. Notes need block anchors — re-import to add them.',
      );
      return;
    }
    // Warm the geometry cache while the user is still typing, so choosing feels
    // instant. Failure is fine; buildReference falls back on its own.
    if (this.settings.pdfFolder) void this.positions.ensure();

    new HighlightPicker(this.app, entries, (entry) => {
      void this.insert(entry);
    }).open();
  }

  private async insert(entry: HighlightEntry): Promise<void> {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) return;
    const sourcePath = this.app.workspace.activeEditor?.file?.path ?? '';
    editor.replaceSelection(await this.buildReference(entry, sourcePath));
  }

  /**
   * The markdown to insert.
   *
   * The PDF form is used only when everything it needs is actually present: a
   * configured folder, the PDF in the vault, and usable geometry from Zotero.
   * Any gap falls back to the note's block anchor, which needs none of that and
   * therefore always works.
   */
  async buildReference(entry: HighlightEntry, sourcePath: string): Promise<string> {
    const note = this.app.metadataCache.fileToLinktext(entry.file, sourcePath, true);
    const base = {
      note,
      cite: entry.citation,
      key: entry.key,
      quote: displayText(entry),
      pageLabel: entry.pageLabel,
    };

    const pdf = await this.resolvePdfTarget(entry, sourcePath);
    if (pdf) {
      return render(this.settings.highlightInsertTemplate, { ...base, ...pdf });
    }
    return render(this.settings.highlightFallbackTemplate, {
      ...base,
      pdf: '',
      page: '',
      rect: '',
      color: '',
    });
  }

  private async resolvePdfTarget(
    entry: HighlightEntry,
    sourcePath: string,
  ): Promise<{ pdf: string; page: string; rect: string; color: string } | null> {
    if (!this.settings.pdfFolder) return null;
    if (!(await this.positions.ensure())) return null;

    const position = this.positions.get(entry.key);
    if (!position) return null;

    const file = this.pdfFor(position.attachmentKey);
    if (!file) return null;

    const box = groupedRect(position.rects);
    if (!box) return null;

    return {
      pdf: this.app.metadataCache.fileToLinktext(file, sourcePath, true),
      // pageIndex is 0-based; PDF links are 1-based.
      page: String(position.pageIndex + 1),
      rect: formatRect(box),
      // Without the leading '#', which would be a second fragment marker inside
      // the link. PDF++ ignores a colour it cannot parse, so the worst case is a
      // default-coloured highlight rather than a broken link.
      color: (position.color ?? '').replace(/^#/, ''),
    };
  }

  /**
   * The PDF for an attachment key.
   *
   * Zotero stores each attachment in `storage/<attachmentKey>/`, so once that
   * tree is visible in the vault the folder name *is* the key — no filesystem
   * access or database lookup needed.
   */
  private pdfFor(attachmentKey: string): TFile | null {
    const root = this.settings.pdfFolder.replace(/\/+$/, '');
    const prefix = `${root}/${attachmentKey}/`;
    for (const file of this.app.vault.getFiles()) {
      if (file.extension === 'pdf' && file.path.startsWith(prefix)) return file;
    }
    return null;
  }
}

function render(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    name in values ? values[name]! : whole,
  );
}

class HighlightPicker extends FuzzySuggestModal<HighlightEntry> {
  constructor(
    app: App,
    private entries: HighlightEntry[],
    private onChoose: (entry: HighlightEntry) => void,
  ) {
    super(app);
    this.setPlaceholder('Search highlights by text, author or citekey…');
  }

  getItems(): HighlightEntry[] {
    return this.entries;
  }

  /** Searchable text: the highlight, its comment, and how it is cited — so
   *  "ochi subgroup" narrows to one paper's highlights in a single query. */
  getItemText(entry: HighlightEntry): string {
    return `${displayText(entry)} ${entry.comment} ${entry.citation} ${entry.citekey}`;
  }

  renderSuggestion(match: FuzzyMatch<HighlightEntry>, el: HTMLElement): void {
    const entry = match.item;
    el.createDiv({ text: displayText(entry) });
    const meta = entry.pageLabel
      ? `${entry.citation} · pg ${entry.pageLabel}`
      : entry.citation;
    el.createDiv({ text: meta, cls: 'setting-item-description' });
  }

  onChooseItem(entry: HighlightEntry): void {
    this.onChoose(entry);
  }
}
