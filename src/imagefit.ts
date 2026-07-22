import { App, Plugin, TFile } from 'obsidian';

import { TrackedIndex } from './tracked';
import { ZoteroMirrorSettings } from './types';

/**
 * Rebalancing imported figure widths.
 *
 * The Zotero Integration template stamps every image annotation with one fixed
 * width (`|350`), because the data it receives has no image dimensions — so a
 * near-square figure and a wide panorama render at wildly different heights. The
 * annotation image files, however, are plain PNGs whose real pixel size *is*
 * readable here. This reads each one and rewrites that single "auto" width to a
 * per-figure width, so figures render at comparable size.
 *
 * Only the exact auto width is touched: any other width is a deliberate manual
 * override (set in the Zotero comment) and is left alone. Hooked to note changes
 * like the citekey resolver, so it applies to Mirror imports, hand-run imports,
 * and edits alike.
 */
export class ImageFitter {
  private timers = new Map<string, number>();

  constructor(
    private app: App,
    private settings: ZoteroMirrorSettings,
    private tracked: TrackedIndex,
  ) {}

  registerEvents(plugin: Plugin): void {
    plugin.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        // Gated on the device flag, like every note-writing feature: only one
        // device should mutate notes, or LiveSync gets conflicting copies.
        if (!this.settings.enabledOnThisDevice) return;
        if (!this.settings.fitImageWidths) return;
        if (!this.tracked.isSourceNote(file)) return;
        this.schedule(file);
      }),
    );
    plugin.register(() => {
      for (const handle of this.timers.values()) window.clearTimeout(handle);
      this.timers.clear();
    });
  }

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

  /** Returns true if the note was rewritten. */
  async fixup(file: TFile): Promise<boolean> {
    if (!this.settings.fitImageWidths) return false;
    if (!this.tracked.isSourceNote(file)) return false;

    let content: string;
    try {
      content = await this.app.vault.cachedRead(file);
    } catch {
      return false;
    }

    // Only embeds at exactly the auto width; a manual override is any other.
    const targets = [...content.matchAll(EMBED)].filter(
      (m) => Number(m[2]) === this.settings.imageFitAutoWidth,
    );
    if (targets.length === 0) return false;

    let after = content;
    let changed = false;
    for (const m of targets) {
      const [whole, path] = [m[0], m[1]!];
      const dims = await this.dimensions(path, file.path);
      if (!dims) continue;
      const width = fitWidth(dims.width, dims.height, this.settings);
      const replacement = `![[${path}|${width}]]`;
      if (replacement !== whole) {
        after = after.split(whole).join(replacement);
        changed = true;
      }
    }

    if (!changed || after === content) return false;
    await this.app.vault.modify(file, after);
    return true;
  }

  /** Every source note at once — for applying it retroactively. */
  async sweep(): Promise<number> {
    let count = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.tracked.isSourceNote(file)) continue;
      if (await this.fixup(file)) count++;
    }
    return count;
  }

  /** Native pixel dimensions of an embedded PNG, resolved against the vault. */
  private async dimensions(
    linkpath: string,
    sourcePath: string,
  ): Promise<{ width: number; height: number } | null> {
    const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    if (!file) return null;
    try {
      return pngSize(await this.app.vault.readBinary(file));
    } catch {
      return null;
    }
  }
}

const DEBOUNCE_MS = 1500;

/** An image embed with an explicit numeric width: `![[path/to.png|350]]`. */
const EMBED = /!\[\[([^[\]|#]+?\.png)\|(\d+)\]\]/gi;

/**
 * The balanced display width for an image, in pixels.
 *
 * Uniform-area: a square figure gets `target`, wider figures scale up by
 * `sqrt(aspect)` and taller ones down, so displayed heights land in a similar
 * band instead of the wild swing a fixed width produces. Clamped to
 * `[min, max]`, and never above the image's own pixel width — upscaling only
 * blurs, and a genuinely huge figure is better served by a manual override.
 */
export function fitWidth(
  pixelWidth: number,
  pixelHeight: number,
  settings: Pick<
    ZoteroMirrorSettings,
    'imageFitTargetWidth' | 'imageFitMinWidth' | 'imageFitMaxWidth'
  >,
): number {
  if (!(pixelWidth > 0) || !(pixelHeight > 0)) return settings.imageFitTargetWidth;
  const aspect = pixelWidth / pixelHeight;
  let width = Math.round(settings.imageFitTargetWidth * Math.sqrt(aspect));
  width = Math.min(Math.max(width, settings.imageFitMinWidth), settings.imageFitMaxWidth);
  return Math.min(width, pixelWidth);
}

/** Width/height from a PNG header, or null if it is not a PNG. */
export function pngSize(buffer: ArrayBuffer): { width: number; height: number } | null {
  if (buffer.byteLength < 24) return null;
  const bytes = new Uint8Array(buffer, 0, 8);
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!SIG.every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(buffer);
  // IHDR width/height are the first two big-endian uint32 after the 16-byte
  // signature-plus-length-plus-"IHDR" preamble.
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}
