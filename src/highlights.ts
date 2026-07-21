import { App, CachedMetadata, Plugin, TFile } from 'obsidian';

import { TrackedIndex } from './tracked';
import { ZoteroMirrorSettings } from './types';

export interface HighlightEntry {
  /** The Zotero annotation key, and the note's block anchor. Stable across
   *  reimports, which is what makes a reference to it durable. */
  key: string;
  /** The highlight itself, stripped of markup. Empty for bare images. */
  text: string;
  /** Any comment written under it in Zotero. */
  comment: string;
  /** The page as *printed* on the paper. Display only — never build a PDF link
   *  from this; see PositionIndex. */
  pageLabel: string;
  file: TFile;
  citekey: string;
  /** "Ochi et al. 2026" */
  citation: string;
}

/** A highlight line ends with the annotation key as a block anchor. */
const ANCHORED_LINE = /\^([A-Z0-9]{8})\s*$/;

/** The trailing ` ([pg 2](zotero://…)) ^KEY` the template appends. */
const BACKLINK_SUFFIX = /\s*\(\[[^\]]*\]\(zotero:\/\/[^)]*\)\)\s*\^[A-Z0-9]{8}\s*$/;

/** `[pg 2]` / `[link]` inside that suffix. */
const PAGE_LABEL = /\(\[pg\s*([^\]]*)\]\(zotero:\/\//;

/** Leading list bullet, heading hashes, callout markers, indentation. */
const LEADING_MARKUP = /^[\t >]*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+)?/;

/** Colour spans the template wraps non-yellow highlights in. */
const COLOUR_SPAN = /<\/?span[^>]*>/g;

/** An image annotation's embed. */
const IMAGE_EMBED = /!\[\[[^\]]*\]\]/g;

/** A comment line under a highlight: `\t> text` or `> text`. */
const COMMENT_LINE = /^[\t ]*>+\s?(.*)$/;

/**
 * Every Zotero highlight in the vault, searchable.
 *
 * Built by reading the notes rather than Zotero, because the note is what the
 * reference has to point *at* — a highlight Zotero knows about but that has not
 * been imported yet has nothing to link to.
 */
export class HighlightIndex {
  private byFile = new Map<string, HighlightEntry[]>();
  private dirty = new Set<string>();
  private built = false;

  constructor(
    private app: App,
    private settings: ZoteroMirrorSettings,
    private tracked: TrackedIndex,
  ) {}

  /** Re-parse changed notes lazily; a burst of imports costs one parse each. */
  registerEvents(plugin: Plugin): void {
    plugin.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (this.tracked.isSourceNote(file)) this.dirty.add(file.path);
      }),
    );
    plugin.registerEvent(
      this.app.vault.on('delete', (file) => {
        this.byFile.delete(file.path);
        this.dirty.delete(file.path);
      }),
    );
    plugin.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        this.byFile.delete(oldPath);
        this.dirty.delete(oldPath);
        if (this.tracked.isSourceNote(file)) this.dirty.add(file.path);
      }),
    );
  }

  async all(): Promise<HighlightEntry[]> {
    await this.ensure();
    const out: HighlightEntry[] = [];
    for (const entries of this.byFile.values()) out.push(...entries);
    return out;
  }

  private async ensure(): Promise<void> {
    if (!this.built) {
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (this.tracked.isSourceNote(file)) this.dirty.add(file.path);
      }
      this.built = true;
    }
    if (this.dirty.size === 0) return;
    const paths = [...this.dirty];
    this.dirty.clear();
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await this.parse(file);
      else this.byFile.delete(path);
    }
  }

  private async parse(file: TFile): Promise<void> {
    let content: string;
    try {
      content = await this.app.vault.cachedRead(file);
    } catch {
      this.byFile.delete(file.path);
      return;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const citekey = frontmatterString(cache, this.settings.citekeyProperty) ?? '';
    const citation = shortCitation(cache, file);

    const lines = content.split('\n');
    const entries: HighlightEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const anchor = line.match(ANCHORED_LINE);
      if (!anchor) continue;

      // Comments live on the lines below the highlight, as a blockquote. Stop at
      // the next anchored line so a callout-styled highlight (which also starts
      // with "> ") is never swallowed as the previous one's comment.
      const commentParts: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]!;
        if (ANCHORED_LINE.test(next)) break;
        const comment = next.match(COMMENT_LINE);
        if (!comment) {
          if (next.trim() === '') continue;
          break;
        }
        commentParts.push(comment[1]!.trim());
      }

      entries.push({
        key: anchor[1]!,
        text: cleanHighlight(line),
        comment: commentParts.join(' ').trim(),
        pageLabel: (line.match(PAGE_LABEL)?.[1] ?? '').trim(),
        file,
        citekey,
        citation,
      });
    }
    this.byFile.set(file.path, entries);
  }
}

/** What the user reads in the picker, and searches against. */
export function displayText(entry: HighlightEntry): string {
  if (entry.text) return entry.text;
  // Image annotations have no text of their own; the comment is all there is.
  return entry.comment || '[image]';
}

function cleanHighlight(line: string): string {
  return line
    .replace(BACKLINK_SUFFIX, '')
    .replace(LEADING_MARKUP, '')
    .replace(COLOUR_SPAN, '')
    .replace(IMAGE_EMBED, '')
    .trim();
}

function frontmatterString(cache: CachedMetadata | null, key: string): string | null {
  const raw = cache?.frontmatter?.[key];
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim();
  return value ? value : null;
}

/**
 * "Ochi et al. 2026", from the frontmatter the import template already writes.
 *
 * Authors arrive as wikilinks (`- "[[Ochi, Yotaro]]"`), surname first.
 */
export function shortCitation(cache: CachedMetadata | null, file: TFile): string {
  const override = frontmatterString(cache, 'shortcite');
  if (override) return override;

  const raw = cache?.frontmatter?.authors;
  const authors = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map((a) => surnameOf(String(a)))
    .filter((a): a is string => !!a);
  const year = frontmatterString(cache, 'year') ?? '';

  let names: string;
  if (authors.length === 0) names = file.basename;
  else if (authors.length === 1) names = authors[0]!;
  else if (authors.length === 2) names = `${authors[0]} & ${authors[1]}`;
  else names = `${authors[0]} et al.`;

  return year ? `${names} ${year}` : names;
}

function surnameOf(author: string): string | null {
  const inner = author.replace(/^\s*"?\[\[/, '').replace(/\]\]"?\s*$/, '');
  const surname = inner.split(',')[0]!.trim();
  return surname || null;
}
