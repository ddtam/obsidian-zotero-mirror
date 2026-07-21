import { App, Notice, SuggestModal, TFile, prepareFuzzySearch } from 'obsidian';

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

/** Suggestions shown at once. Enough to scan, few enough to stay responsive. */
const SUGGESTION_LIMIT = 50;

/** How much worse a token matching the citation is than one matching the
 *  highlight, so "ochi" narrowing by author never outranks the words you
 *  actually remember reading. */
const META_MATCH_PENALTY = 1;

/** A compiled fuzzy matcher, as returned by Obsidian's prepareFuzzySearch. */
export type SearchFactory = (query: string) => (text: string) => { score: number } | null;

/**
 * Rank highlights for a query.
 *
 * Every whitespace-separated token must match *something* — the highlight text
 * or the citation — and the scores add up. Matching per token rather than on the
 * whole query is what makes "ochi enrolled" work: the two words live in
 * different fields and in the opposite order to how they are stored.
 *
 * Split out from the modal so the ranking can be tested without Obsidian.
 */
export function rankHighlights(
  entries: HighlightEntry[],
  query: string,
  makeSearch: SearchFactory,
): HighlightEntry[] {
  const tokens = query.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return entries.slice(0, SUGGESTION_LIMIT);

  // Compile each token once, not once per entry.
  const searches = tokens.map((token) => makeSearch(token));
  const scored: Array<{ entry: HighlightEntry; score: number }> = [];

  for (const entry of entries) {
    const text = `${displayText(entry)} ${entry.comment}`;
    const meta = `${entry.citation} ${entry.citekey}`;
    let total = 0;
    let matchedAll = true;

    for (const search of searches) {
      const inText = search(text);
      const inMeta = search(meta);
      if (!inText && !inMeta) {
        matchedAll = false;
        break;
      }
      total += Math.max(
        inText ? inText.score : -Infinity,
        inMeta ? inMeta.score - META_MATCH_PENALTY : -Infinity,
      );
    }

    if (matchedAll) scored.push({ entry, score: total });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, SUGGESTION_LIMIT).map((s) => s.entry);
}

/**
 * The highlight picker.
 *
 * Deliberately not a FuzzySuggestModal. That matches the whole query as a single
 * subsequence, so "ochi enrolled" would require an "ochi" positioned *before* an
 * "enrolled" in one concatenated string -- which silently fails for the most
 * natural query there is, author plus remembered words. Here each whitespace-
 * separated token is matched independently and all must hit, so order does not
 * matter and every token genuinely narrows the result.
 */
class HighlightPicker extends SuggestModal<HighlightEntry> {
  constructor(
    app: App,
    private entries: HighlightEntry[],
    private onChoose: (entry: HighlightEntry) => void,
  ) {
    super(app);
    this.limit = SUGGESTION_LIMIT;
    this.setPlaceholder('Search highlights by text, author or citekey…');
  }

  getSuggestions(query: string): HighlightEntry[] {
    return rankHighlights(this.entries, query, prepareFuzzySearch);
  }

  renderSuggestion(entry: HighlightEntry, el: HTMLElement): void {
    el.createDiv({ text: displayText(entry) });
    const meta = entry.pageLabel
      ? `${entry.citation} · pg ${entry.pageLabel}`
      : entry.citation;
    el.createDiv({ text: meta, cls: 'setting-item-description' });
  }

  onChooseSuggestion(entry: HighlightEntry): void {
    this.onChoose(entry);
  }
}
