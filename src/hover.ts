import { App, HoverParent, HoverPopover, Plugin } from 'obsidian';

import { boxToCanvas, findPdf, renderPage } from './pdfrender';
import { PositionIndex } from './positions';
import { fitScale, groupedRect } from './rects';
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

    let position = link.annotationKey
      ? this.positions.get(link.annotationKey)
      : undefined;
    // The index starts empty on a device that has never reached Zotero and has
    // no cache from a previous session. Without this the preview still renders
    // -- the page comes from the URL -- but silently has no highlights and no
    // scroll target, which looks like a rendering bug rather than missing data.
    if (!position && link.annotationKey) {
      await this.positions.ensure();
      if (this.current !== anchor) return;
      position = this.positions.get(link.annotationKey);
    }

    // The URL's page is unreliable -- the export template writes it empty for
    // page 1 -- and the page *label* in the note is the page printed on the
    // paper, which for a journal article is nothing like the physical page.
    // Zotero's pageIndex is the only trustworthy source.
    const pageNumber =
      position !== undefined ? position.pageIndex + 1 : (link.page ?? 1);

    // Prefer the column-aware reduction both for *where to look* and for how far
    // to zoom: for a highlight wrapping columns, the extent of all rects
    // together spans the page, which would centre on blank space and zoom out
    // until nothing is legible.
    const focus = position ? groupedRect(position.rects) : null;
    // Sized to the highlight rather than fixed, so a three-word note and a
    // half-column passage both arrive readable and whole.
    const scale = focus
      ? fitScale(
          focus,
          this.settings.hoverPopoverWidth,
          this.settings.hoverPopoverHeight,
          this.settings.hoverMinScale,
          this.settings.hoverPopoverScale,
          this.settings.hoverFill,
        )
      : this.settings.hoverPopoverScale;

    // Still the hovered link? A slow render must not pop up over something else.
    if (this.current !== anchor) return;

    let rendered;
    try {
      rendered = await renderPage(
        file,
        pageNumber,
        scale,
        position?.rects ?? [],
        position?.color,
      );
    } catch (e) {
      console.error('[zotero-mirror] failed to render PDF preview', e);
      return;
    }
    if (this.current !== anchor) return;

    const scrollTo = focus
      ? await this.focusBox(file, pageNumber, focus, scale)
      : rendered.target;

    this.build(anchor, rendered.canvas, scrollTo);
  }

  private async focusBox(
    file: string,
    pageNumber: number,
    box: number[],
    scale: number,
  ) {
    try {
      return await boxToCanvas(
        file,
        pageNumber,
        scale,
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
    const { hoverPopoverWidth, hoverPopoverHeight } = this.settings;

    // The popover itself has to be widened, not just its contents. Obsidian
    // sizes .hover-popover from --popover-width (~500px), and a child cannot
    // widen its parent -- so setting this on the inner div only meant the zoom
    // was fitted to a width the viewport never actually had, and anything wider
    // than a column came out cropped. !important because the rule it overrides
    // is a stylesheet rule, and padding is cleared so the usable width is
    // exactly what was fitted to.
    const el = popover.hoverEl;
    el.style.setProperty('width', `${hoverPopoverWidth}px`, 'important');
    el.style.setProperty('max-width', `${hoverPopoverWidth}px`, 'important');
    el.style.setProperty('padding', '0', 'important');
    el.style.setProperty('max-height', `${hoverPopoverHeight}px`, 'important');

    // Styled inline rather than via styles.css, so the plugin stays two files
    // to install and there is no stylesheet to keep in every release.
    const scroller = el.createDiv();
    scroller.style.overflow = 'auto';
    scroller.style.width = '100%';
    scroller.style.height = `${hoverPopoverHeight}px`;
    canvas.style.display = 'block';
    scroller.appendChild(canvas);
    if (focus) centreOn(scroller, focus);
  }
}

/** Give up waiting for the popover to be laid out. */
const LAYOUT_TIMEOUT_MS = 3000;

/**
 * Scroll a container so a box in canvas pixels sits in the middle.
 *
 * Cannot simply be done on the next frame. `HoverPopover` shows itself after a
 * delay, so at construction `hoverEl` has no layout: `clientHeight` is 0 and
 * assigning `scrollTop` to an unlaid-out element is silently discarded, leaving
 * the preview at the top-left corner. So try immediately, and otherwise wait for
 * the element to actually acquire a size.
 *
 * Both axes matter: a rendered page is usually wider than the popover, so a
 * highlight in the right-hand column needs horizontal centring too.
 */
function centreOn(scroller: HTMLElement, box: number[]): void {
  const apply = (): boolean => {
    const height = scroller.clientHeight;
    const width = scroller.clientWidth;
    if (!height || !width) return false;

    const midY = (box[1]! + box[3]!) / 2;
    const midX = (box[0]! + box[2]!) / 2;
    scroller.scrollTop = clamp(midY - height / 2, scroller.scrollHeight - height);
    scroller.scrollLeft = clamp(midX - width / 2, scroller.scrollWidth - width);
    return true;
  };

  if (apply()) return;

  const observer = new ResizeObserver(() => {
    if (apply()) observer.disconnect();
  });
  observer.observe(scroller);
  window.setTimeout(() => observer.disconnect(), LAYOUT_TIMEOUT_MS);
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, Math.max(0, max)));
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
