import { App, Plugin, TFile } from 'obsidian';

import { TrackedIndex } from './tracked';
import { ZoteroMirrorSettings } from './types';

/**
 * Making `[[citekey]]` links resolve.
 *
 * Citekeys get pasted into Zotero annotation comments as bare wikilinks, and the
 * import carries them through verbatim. They do not resolve: Obsidian matches a
 * link target against filenames and paths only — it never consults `aliases`,
 * so an alias on the note does not help. The fix is to rewrite the link to name
 * the file while still *displaying* the citekey.
 *
 *   [[ochiChromatin…2026]]           ->  [[Chromatin landscape…|ochiChromatin…2026]]
 *   [[ochiChromatin…2026#^S3LPBJB7]] ->  [[Chromatin landscape…#^S3LPBJB7|ochiChromatin…2026]]
 *
 * Hooked to note changes rather than to our own imports, so it applies equally
 * to a hand-run Zotero import or text typed directly into the note.
 */
export class CitekeyLinkResolver {
  private timers = new Map<string, number>();

  constructor(
    private app: App,
    private settings: ZoteroMirrorSettings,
    private tracked: TrackedIndex,
  ) {}

  registerEvents(plugin: Plugin): void {
    plugin.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        // Gated on the device flag for the same reason imports are: only one
        // device should be writing notes, or LiveSync gets conflicting copies.
        if (!this.settings.enabledOnThisDevice) return;
        if (!this.settings.resolveCitekeyLinks) return;
        if (!this.tracked.isSourceNote(file)) return;
        this.schedule(file);
      }),
    );
    plugin.register(() => {
      for (const handle of this.timers.values()) window.clearTimeout(handle);
      this.timers.clear();
    });
  }

  /** Coalesce edits so we rewrite once things settle, not mid-keystroke. */
  private schedule(file: TFile): void {
    const existing = this.timers.get(file.path);
    if (existing) window.clearTimeout(existing);
    this.timers.set(
      file.path,
      window.setTimeout(() => {
        this.timers.delete(file.path);
        void this.fixup(file);
      }, DEBOUNCE_MS),
    );
  }

  /** Returns true if the file was rewritten. */
  async fixup(file: TFile): Promise<boolean> {
    if (!this.settings.resolveCitekeyLinks) return false;
    if (!this.tracked.isSourceNote(file)) return false;

    let before: string;
    try {
      before = await this.app.vault.cachedRead(file);
    } catch {
      return false;
    }
    const after = this.rewrite(before, file.path);
    // Writing an identical file would still cost a LiveSync revision, and would
    // re-trigger this handler forever. Rewritten links contain a '|' and so no
    // longer match, which is what makes the second pass a guaranteed no-op.
    if (after === before) return false;

    await this.app.vault.modify(file, after);
    return true;
  }

  /** Every source note at once — for turning the feature on retroactively. */
  async sweep(): Promise<number> {
    let changed = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.tracked.isSourceNote(file)) continue;
      if (await this.fixup(file)) changed++;
    }
    return changed;
  }

  private rewrite(content: string, sourcePath: string): string {
    return content.replace(WIKILINK, (whole, target: string, anchor: string) => {
      const citekey = target.trim();
      const file = this.tracked.fileFor(citekey);
      // Not a known citekey: an ordinary [[Title]], [[Author, Name]] or [[wip]]
      // link, which must be left exactly as it is.
      if (!file) return whole;
      if (file.path === sourcePath) return whole;

      const linktext = this.app.metadataCache.fileToLinktext(file, sourcePath, true);
      // Already resolvable as written (the note is named for its citekey);
      // rewriting would only produce [[citekey|citekey]].
      if (linktext === citekey) return whole;

      return `[[${linktext}${anchor}|${citekey}]]`;
    });
  }
}

const DEBOUNCE_MS = 1500;

/**
 * A wikilink with no display text: `[[target]]` or `[[target#anchor]]`.
 *
 * Excluding '|' from both groups is load-bearing. A link that already has
 * display text cannot match — the closing `]]` never follows the target — so
 * links this class has already rewritten are structurally skipped, and the
 * rewrite is idempotent.
 */
const WIKILINK = /\[\[([^\[\]|#]+)((?:#[^\[\]|]*)?)\]\]/g;
