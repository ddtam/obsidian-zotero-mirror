import { App, HoverParent, HoverPopover, Plugin } from 'obsidian';

import {
  RenderedPage,
  boxToCanvas,
  findPdf,
  pageSize,
  renderPage,
} from './pdfrender';
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
 *
 * The same links are also written without an annotation, as a citation pointing
 * at a paper rather than at a passage in it. Those preview the top of page 1,
 * fitted to the popover's width.
 */
export class HighlightHover implements HoverParent {
  hoverPopover: HoverPopover | null = null;

  /** The link the visible popover belongs to, so re-entering does not rebuild. */
  private current: HTMLAnchorElement | null = null;

  /** Windows already wired up, so a re-sweep cannot double-register one. */
  private readonly attached = new WeakSet<Window>();

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
    const onMouseOver = (evt: MouseEvent) => {
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
    };

    // A popout is a separate document: its nodes are not under the main
    // window's `document`, so one listener there never sees them. Each window
    // gets its own listener and its own copy of the stylesheet.
    const attach = (win: Window) => {
      if (this.attached.has(win)) return;
      this.attached.add(win);

      // The scrollbar is a pseudo-element, so it cannot be hidden with inline
      // styles. A one-line injected stylesheet keeps the plugin at two files
      // to install (no styles.css to ship) while still hiding it. Removed on
      // unload; a popout that closes first takes its own copy with it, which
      // is why removal is allowed to fail.
      const style = win.document.head.createEl('style');
      style.textContent = `.${PREVIEW_CLASS}::-webkit-scrollbar{display:none}`;
      plugin.register(() => {
        try {
          style.remove();
        } catch {
          // Its window is already gone, taking the stylesheet with it.
        }
      });

      plugin.registerDomEvent(win.document, 'mouseover', onMouseOver);
    };

    attach(window);

    plugin.registerEvent(
      this.app.workspace.on('window-open', (_container, win) => attach(win)),
    );

    // A popout restored with the workspace may already exist by the time the
    // layout settles, and `window-open` does not fire again for it.
    this.app.workspace.onLayoutReady(() => {
      this.app.workspace.iterateAllLeaves((leaf) => {
        attach(leaf.getContainer().win);
      });
    });
  }

  private async show(anchor: HTMLAnchorElement): Promise<void> {
    const href = anchor.getAttribute('href') ?? '';
    const link = parseZoteroLink(href);
    if (!link) {
      if (this.settings.hoverDebug) console.log('[zotero-mirror] no preview: unparsable link', href);
      return;
    }

    const file = findPdf(this.settings.zoteroDataDir, link.attachmentKey);
    // No local PDF is an ordinary state (linked-file attachment, or WebDAV has
    // not fetched it). Leave the link alone; clicking still opens Zotero.
    if (!file) {
      if (this.settings.hoverDebug) {
        console.log('[zotero-mirror] no preview: no PDF for attachment', {
          attachment: link.attachmentKey,
          lookedIn: `${this.settings.zoteroDataDir}/storage/${link.attachmentKey}/`,
        });
      }
      return;
    }

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
      // Still missing: the library index loads once per session, so a highlight
      // made after that — e.g. one whose reference was just pasted from Zotero —
      // is absent. Fetch that one annotation so its highlight can be drawn.
      if (!position) {
        await this.positions.fetchOne(link.annotationKey);
        if (this.current !== anchor) return;
        position = this.positions.get(link.annotationKey);
      }
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
    let scale: number;
    if (focus) {
      scale = fitScale(
        focus,
        this.settings.hoverPopoverWidth,
        this.settings.hoverPopoverHeight,
        this.settings.hoverMinScale,
        this.settings.hoverMaxScale,
        this.settings.hoverFill,
      );
    } else if (!link.annotationKey) {
      scale = await this.pageFitScale(file, pageNumber);
      if (this.current !== anchor) return;
    } else {
      // An annotation was named but its geometry is missing, so the page is
      // right and the target is not. Keep the old zoom rather than framing a
      // whole page the reader did not ask for.
      scale = this.settings.hoverMaxScale;
    }

    if (this.settings.hoverDebug) {
      console.log('[zotero-mirror] preview', {
        annotation: link.annotationKey,
        positionFound: position !== undefined,
        rects: position?.rects.length ?? 0,
        focusPt: focus
          ? `${(focus[2] - focus[0]).toFixed(0)}x${(focus[3] - focus[1]).toFixed(0)}`
          : null,
        settings: {
          fill: this.settings.hoverFill,
          viewport: `${this.settings.hoverPopoverWidth}x${this.settings.hoverPopoverHeight}`,
          clamp: `${this.settings.hoverMinScale}..${this.settings.hoverMaxScale}`,
        },
        scale: Number(scale.toFixed(3)),
        clampedAtMax: scale === this.settings.hoverMaxScale,
        clampedAtMin: scale === this.settings.hoverMinScale,
      });
    }

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

    this.build(anchor, rendered, scrollTo, !link.annotationKey);
  }

  /**
   * Zoom for a link that names no annotation, such as a citation.
   *
   * Fits the page's WIDTH, not the whole page. Fitting both axes puts a letter
   * page at about 0.53 in the default 620x420 popover, where a 14pt title
   * renders under 8px and nothing is readable; the width alone gives about
   * 1.01, so the preview opens on a legible title block and scrolls down.
   *
   * `hoverFill` is deliberately NOT applied. It is margin around a highlight,
   * so that a marked phrase is not framed flush to the popover's edge. A page
   * has its own margins already, and holding back 10% here just left a strip
   * of empty popover beside it. Still clamped by the configured zoom bounds.
   */
  private async pageFitScale(file: string, pageNumber: number): Promise<number> {
    const { hoverPopoverWidth, hoverMinScale, hoverMaxScale } = this.settings;
    let width: number;
    try {
      ({ width } = await pageSize(file, pageNumber));
    } catch {
      return hoverMaxScale;
    }
    const scale = hoverPopoverWidth / width;
    if (!Number.isFinite(scale) || scale <= 0) return hoverMaxScale;
    return Math.min(Math.max(scale, hoverMinScale), hoverMaxScale);
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
    rendered: RenderedPage,
    focus: number[] | null,
    wholePage: boolean,
  ): void {
    const popover = new HoverPopover(this, anchor);

    // Escape dismisses the preview, and does only that.
    //
    // Capture phase on the hovered link's OWN document, which is the popout's
    // when the link is in one. Capture on the document runs before Obsidian's
    // keymap, which listens on the window, and before any handler a plugin
    // has put on a view inside it -- Dendrite drives card editing and board
    // navigation from Escape, and one press must not both close this and act
    // there. Stopping propagation is what keeps the two apart.
    //
    // Registered on the popover rather than the plugin, so it is removed
    // whenever the popover goes away, whether by this key or by the mouse
    // leaving. Nothing is left listening between previews.
    //
    // `current` is deliberately NOT cleared: it still names this link, so the
    // preview does not spring back while the cursor is sitting on it. Moving
    // off the link clears it, and hovering again rebuilds.
    const doc = anchor.doc;
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key !== 'Escape') return;
      evt.preventDefault();
      evt.stopPropagation();
      dismiss(popover);
    };
    doc.addEventListener('keydown', onKeyDown, true);
    popover.register(() => doc.removeEventListener('keydown', onKeyDown, true));
    const { hoverPopoverHeight } = this.settings;

    // A whole-page preview is as wide as the page came out, which is narrower
    // than the configured width whenever the zoom bounds clamped the fit --
    // a small page cannot reach it at hoverMaxScale. Keeping the configured
    // width there would park the page against a strip of empty popover.
    // Highlight previews keep the configured width: their render is usually
    // wider than the popover and is meant to be panned inside it.
    const hoverPopoverWidth =
      wholePage && rendered.page.width < this.settings.hoverPopoverWidth
        ? rendered.page.width
        : this.settings.hoverPopoverWidth;

    // The popover itself has to be widened, not just its contents. Obsidian
    // sizes .hover-popover from --popover-width (~500px), and a child cannot
    // widen its parent -- so setting this on the inner div only meant the zoom
    // was fitted to a width the viewport never actually had, and anything wider
    // than a column came out cropped. !important because the rule it overrides
    // is a stylesheet rule, and padding is cleared so the usable width is
    // exactly what was fitted to.
    const el = popover.hoverEl;
    // Obsidian sets `box-sizing: border-box` globally, so a width of 620 with
    // a 1px border leaves 618 usable and the fitted page is clipped on the
    // right. content-box makes the configured width the width the render
    // actually gets, which is what every fit here already assumes.
    el.style.setProperty('box-sizing', 'content-box', 'important');
    el.style.setProperty('width', `${hoverPopoverWidth}px`, 'important');
    el.style.setProperty('max-width', `${hoverPopoverWidth}px`, 'important');
    el.style.setProperty('padding', '0', 'important');
    el.style.setProperty('max-height', `${hoverPopoverHeight}px`, 'important');

    // Styled inline rather than via styles.css, so the plugin stays two files
    // to install and there is no stylesheet to keep in every release.
    // Still scrollable -- panning and the wheel both set scrollLeft/scrollTop --
    // just with the scrollbar hidden, since drag-to-pan replaces it. The class
    // hides it in Chromium; scrollbar-width covers the standard property too.
    const scroller = el.createDiv({ cls: PREVIEW_CLASS });
    scroller.style.overflow = 'auto';
    scroller.style.setProperty('scrollbar-width', 'none');
    scroller.style.width = '100%';
    scroller.style.height = `${hoverPopoverHeight}px`;

    // The page and the highlights are stacked as two layers. The dim is applied
    // to the page alone, so the highlights keep their full colour over a
    // softened page -- what a filter on one composited canvas could not do.
    const stack = scroller.createDiv();
    stack.style.position = 'relative';
    stack.style.width = `${rendered.page.width}px`;
    stack.style.height = `${rendered.page.height}px`;

    rendered.page.style.display = 'block';
    // A bright white page is jarring over a dark note but fine on a light one,
    // so the dim is theme-specific. It pulls brightness and saturation down
    // together: desaturating white, which has none, would not dim it.
    // The popout has its own body, carrying its own theme class.
    const dark = anchor.doc.body.classList.contains('theme-dark');
    const configured = dark ? this.settings.hoverDimDark : this.settings.hoverDimLight;
    const dim = Math.min(Math.max(configured, 0), 1);
    if (dim > 0) {
      rendered.page.style.filter = `brightness(${(1 - dim * 0.5).toFixed(3)}) saturate(${(
        1 - dim * 0.7
      ).toFixed(3)})`;
    }
    stack.appendChild(rendered.page);

    rendered.overlay.style.position = 'absolute';
    rendered.overlay.style.left = '0';
    rendered.overlay.style.top = '0';
    stack.appendChild(rendered.overlay);

    enableDragScroll(scroller);
    if (focus) centreOn(scroller, focus);
  }
}

/**
 * Close a popover.
 *
 * `hide()` is the method Obsidian uses internally and it is not in the public
 * typings, so it is called defensively, with the public `unload()` -- which is
 * where `hide()` ends up anyway -- as the fallback.
 */
function dismiss(popover: HoverPopover): void {
  const hide = (popover as unknown as { hide?: () => void }).hide;
  if (typeof hide === 'function') hide.call(popover);
  else popover.unload();
}

/**
 * Grab-and-pan the preview, so it can be moved by dragging rather than only by
 * the scrollbar or wheel -- easier to aim in a small popover.
 *
 * Listeners live on the element itself and go with it when the popover closes,
 * so there is nothing to unregister. Pointer capture keeps the drag tracking
 * even when the cursor briefly leaves the element, which also stops a fast drag
 * from dismissing a hover popover by wandering off it.
 */
function enableDragScroll(el: HTMLElement): void {
  el.style.cursor = 'grab';
  // Or the canvas gets selected/ghost-dragged instead of the view panning.
  el.style.userSelect = 'none';

  let panning = false;
  let originX = 0;
  let originY = 0;
  let fromLeft = 0;
  let fromTop = 0;

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; // left button only
    panning = true;
    originX = e.clientX;
    originY = e.clientY;
    fromLeft = el.scrollLeft;
    fromTop = el.scrollTop;
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    if (!panning) return;
    el.scrollLeft = fromLeft - (e.clientX - originX);
    el.scrollTop = fromTop - (e.clientY - originY);
  });

  const release = (e: PointerEvent) => {
    if (!panning) return;
    panning = false;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      // The pointer may already be released; nothing to undo.
    }
    el.style.cursor = 'grab';
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
}

/** Class on the scroll container, so its scrollbar can be hidden by rule. */
const PREVIEW_CLASS = 'zotero-mirror-preview';

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
  // The scroller's own window, so a closing popout cancels its own timer.
  scroller.win.setTimeout(() => observer.disconnect(), LAYOUT_TIMEOUT_MS);
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
