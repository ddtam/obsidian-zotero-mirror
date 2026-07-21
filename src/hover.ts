import { App, HoverParent, HoverPopover, Plugin } from 'obsidian';

import { boxToCanvas, findPdf, renderPage } from './pdfrender';
import { PositionIndex } from './positions';
import { groupedRect } from './rects';
import { ZoteroMirrorSettings } from './types';

/**
 * Previewing a Zotero highlight in its PDF page, on hover.
 *
 * Hooks `zotero://open-pdf/...` links, which every imported highlight already
 * carries as its `[pg N]` backlink -- so this lights up existing notes with no
 * relinking, and the same links keep working as click-throughs into Zotero when
 * the plugin is absent.
 *
 * Deliberately not wikilinks: Obsidian previews those itself, and two popovers
 * competing for one link is a fight with core behaviour. A custom protocol has
 * no native preview, so ours is uncontested and the click is Zotero's.
 */
export class HighlightHover implements HoverParent {
  hoverPopover: HoverPopover | null = null;

  /** The link the visible popover belongs to, so re-entering does not rebuild. */
  private current: HTMLAnchorElement | null = null;

  constructor(
    private app: App,
    private settings: ZoteroMirrorSettings,
    private positions: PositionIndex,
  ) {}

  /** Repoint after the Zotero client is rebuilt (host/port change). */
  setPositions(positions: PositionIndex): void {
    this.positions = positions;
  }

  registerEvents(plugin: Plugin): void {
    plugin.registerDomEvent(document, 'mouseover', (evt: MouseEvent) => {
      const anchor = zoteroAnchorFrom(evt.target);
      if (!anchor) {
        this.current = null;
        return;
      }
      if (!this.settings.hoverPreviews) return;
      if (this.settings.hoverRequiresModKey && !(evt.ctrlKey || evt.metaKey)) return;
      if (anchor === this.current) return;
      this.current = anchor;
      void this.show(anchor);
    });
  }

  private async show(anchor: HTMLAnchorElement): Promise<void> {
    const link = parseZoteroLink(anchor.getAttribute('href') ?? '');
    if (!link) return;

    const file = findPdf(this.settings.zoteroDataDir, link.attachmentKey);
    // No local PDF is an ordinary state (linked-file attachment, or WebDAV has
    // not fetched it). Leave the link alone; clicking still opens Zotero.
    if (!file) return;

    const position = link.annotationKey
      ? this.positions.get(link.annotationKey)
      : undefined;

    // The URL's page is unreliable -- the export template writes it empty for
    // page 1 -- and the page *label* in the note is the page printed on the
    // paper, which for a journal article is nothing like the physical page.
    // Zotero's pageIndex is the only trustworthy source.
    const pageNumber =
      position !== undefined ? position.pageIndex + 1 : (link.page ?? 1);

    // Still the hovered link? A slow render must not pop up over something else.
    if (this.current !== anchor) return;

    let rendered;
    try {
      rendered = await renderPage(
        file,
        pageNumber,
        this.settings.hoverPopoverScale,
        position?.rects ?? [],
        position?.color,
      );
    } catch (e) {
      console.error('[zotero-mirror] failed to render PDF preview', e);
      return;
    }
    if (this.current !== anchor) return;

    // Prefer the column-aware reduction for *where to look*, even though every
    // rect is drawn: for a highlight wrapping columns, the centre of all rects
    // together is a point on the page where nothing is highlighted.
    const focus = position ? groupedRect(position.rects) : null;
    const scrollTo = focus
      ? await this.focusBox(file, pageNumber, focus)
      : rendered.target;

    this.build(anchor, rendered.canvas, scrollTo);
  }

  private async focusBox(file: string, pageNumber: number, box: number[]) {
    try {
      return await boxToCanvas(
        file,
        pageNumber,
        this.settings.hoverPopoverScale,
        box as [number, number, number, number],
      );
    } catch {
      return null;
    }
  }

  private build(
    anchor: HTMLAnchorElement,
    canvas: HTMLCanvasElement,
    focus: number[] | null,
  ): void {
    const popover = new HoverPopover(this, anchor);
    const scroller = popover.hoverEl.createDiv();
    // Styled inline rather than via styles.css, so the plugin stays two files
    // to install and there is no stylesheet to keep in every release.
    scroller.style.overflow = 'auto';
    scroller.style.maxHeight = `${this.settings.hoverPopoverHeight}px`;
    scroller.style.maxWidth = '100%';
    canvas.style.display = 'block';
    scroller.appendChild(canvas);

    // Land on the highlight rather than the top of the page, then let the user
    // scroll for surrounding context -- the same feel as Obsidian's own note
    // previews, which scroll rather than truncate.
    if (focus) {
      requestAnimationFrame(() => {
        const middle = (focus[1] + focus[3]) / 2;
        scroller.scrollTop = Math.max(0, middle - scroller.clientHeight / 2);
      });
    }
  }
}

/** The nearest enclosing zotero://open-pdf link, if the hover is over one. */
function zoteroAnchorFrom(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const anchor = target.closest('a');
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  const href = anchor.getAttribute('href') ?? '';
  return href.startsWith('zotero://open-pdf') ? anchor : null;
}

export interface ZoteroLink {
  attachmentKey: string;
  annotationKey: string | null;
  /** 1-based, and absent for page 1 in existing notes. */
  page: number | null;
}

/**
 * Pull the keys out of `zotero://open-pdf/library/items/KEY?page=N&annotation=K`.
 *
 * Hand-parsed rather than via URL: the scheme is non-standard enough that
 * pathname/search handling is not worth relying on.
 */
export function parseZoteroLink(href: string): ZoteroLink | null {
  const item = href.match(/\/items\/([A-Z0-9]+)/i);
  if (!item) return null;
  const page = href.match(/[?&]page=(\d+)/i);
  const annotation = href.match(/[?&]annotation=([A-Z0-9]+)/i);
  return {
    attachmentKey: item[1]!,
    annotationKey: annotation ? annotation[1]! : null,
    page: page ? parseInt(page[1]!, 10) : null,
  };
}
