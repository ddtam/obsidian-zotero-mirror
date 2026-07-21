import * as fs from 'fs';
import * as path from 'path';

import { loadPdfJs } from 'obsidian';

import { Box, Rect } from './rects';

/**
 * Rendering a page of a Zotero PDF, with its highlights drawn on top.
 *
 * The PDF is read straight from Zotero's storage directory. Nothing is copied
 * into the vault -- which is the whole point: the alternative was symlinking
 * ~/Zotero/storage in, and a symlink is transparent to sync, so that meant
 * several GB replicating to the remote.
 *
 * Every pdf.js call in the plugin lives here. `loadPdfJs()` hands back
 * *Obsidian's* bundled build, and pdf.js changes its API across major versions,
 * so keeping the surface in one file means a future break is one file to fix.
 */

/** Documents kept parsed. Small, because these can be tens of MB each. */
const MAX_CACHED_DOCUMENTS = 3;

/** How opaque a drawn highlight is over the page. */
const HIGHLIGHT_ALPHA = 0.33;

const DEFAULT_HIGHLIGHT_COLOUR = '#ffd400';

export interface RenderedPage {
  /** The page. Dimming is applied to this layer only. */
  page: HTMLCanvasElement;
  /** The highlights, on a transparent layer of the same size, so a dim on the
   *  page leaves their colour untouched. */
  overlay: HTMLCanvasElement;
  /** The highlight's location in canvas pixels, for scrolling it into view. */
  target: Box | null;
}

let pdfjsPromise: Promise<any> | null = null;

function pdfjs(): Promise<any> {
  if (!pdfjsPromise) pdfjsPromise = loadPdfJs();
  return pdfjsPromise;
}

/** Insertion-ordered, so the oldest entry is the first key. */
const documents = new Map<string, Promise<any>>();

/**
 * The PDF file for a Zotero attachment.
 *
 * Zotero stores each attachment in `storage/<attachmentKey>/`, so the key is
 * the folder name and no database lookup is needed. Returns null rather than
 * throwing: a paper WebDAV has not fetched, or a linked-file attachment, is a
 * normal state and must degrade to "no preview", never to an error.
 */
export function findPdf(dataDir: string, attachmentKey: string): string | null {
  const dir = path.join(dataDir, 'storage', attachmentKey);
  try {
    const entry = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.pdf'));
    return entry ? path.join(dir, entry) : null;
  } catch {
    return null;
  }
}

function openDocument(file: string): Promise<any> {
  const cached = documents.get(file);
  if (cached) return cached;

  const opening = (async () => {
    const lib = await pdfjs();
    // Read the bytes ourselves rather than handing pdf.js a path: it avoids
    // file:// URL handling differences inside Electron.
    const data = new Uint8Array(fs.readFileSync(file));
    return lib.getDocument({ data }).promise;
  })();

  documents.set(file, opening);
  if (documents.size > MAX_CACHED_DOCUMENTS) {
    const oldest = documents.keys().next().value as string | undefined;
    if (oldest !== undefined && oldest !== file) {
      const stale = documents.get(oldest);
      documents.delete(oldest);
      void stale?.then((d) => d?.destroy?.()).catch(() => {});
    }
  }
  // A failed open must not poison the cache forever.
  opening.catch(() => documents.delete(file));
  return opening;
}

/** Drop every cached document (plugin unload). */
export function releaseDocuments(): void {
  for (const pending of documents.values()) {
    void pending.then((d) => d?.destroy?.()).catch(() => {});
  }
  documents.clear();
}

/**
 * Render one page and mark the highlight on it.
 *
 * `pageNumber` is 1-based, as pdf.js expects. `rects` are Zotero's, in PDF user
 * space with y increasing upward; `convertToViewportRectangle` handles the flip
 * and the scale, so no coordinate maths is hand-rolled here.
 *
 * Every rect is drawn. Zotero stores one per line, and drawing them individually
 * is what makes a highlight wrapping a column break mark only the text it covers
 * -- the thing a single bounding box could never express.
 */
export async function renderPage(
  file: string,
  pageNumber: number,
  scale: number,
  rects: readonly Rect[],
  colour: string | undefined,
): Promise<RenderedPage> {
  const doc = await openDocument(file);
  const clamped = Math.min(Math.max(1, pageNumber), doc.numPages);
  const page = await doc.getPage(clamped);
  const viewport = page.getViewport({ scale });

  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);

  const pageCanvas = document.createElement('canvas');
  pageCanvas.width = width;
  pageCanvas.height = height;
  const pageCtx = pageCanvas.getContext('2d');
  if (!pageCtx) throw new Error('could not get a 2d canvas context');
  await page.render({ canvasContext: pageCtx, viewport }).promise;

  // Highlights go on their own layer so a dim applied to the page cannot touch
  // their colour -- the reason a single composited canvas could not be dimmed
  // without washing them out too.
  const overlay = document.createElement('canvas');
  overlay.width = width;
  overlay.height = height;
  const overlayCtx = overlay.getContext('2d');
  if (!overlayCtx) throw new Error('could not get a 2d canvas context');
  overlayCtx.globalAlpha = HIGHLIGHT_ALPHA;
  overlayCtx.fillStyle = colour || DEFAULT_HIGHLIGHT_COLOUR;
  let target: Box | null = null;
  for (const rect of rects) {
    const box = toCanvasBox(viewport, rect);
    if (!box) continue;
    overlayCtx.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    target = target ? mergeBox(target, box) : box;
  }

  return { page: pageCanvas, overlay, target };
}

/** One Zotero rect in canvas pixels as [left, top, right, bottom]. */
function toCanvasBox(viewport: any, rect: Rect): Box | null {
  if (rect.length < 4) return null;
  if (!rect.slice(0, 4).every((n) => Number.isFinite(n))) return null;
  const [a, b, c, d] = viewport.convertToViewportRectangle([
    rect[0], rect[1], rect[2], rect[3],
  ]) as number[];
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

function mergeBox(x: Box, y: Box): Box {
  return [
    Math.min(x[0], y[0]),
    Math.min(x[1], y[1]),
    Math.max(x[2], y[2]),
    Math.max(x[3], y[3]),
  ];
}

/** Convert a single PDF-space box to canvas pixels, for the scroll target. */
export async function boxToCanvas(
  file: string,
  pageNumber: number,
  scale: number,
  box: Box,
): Promise<Box | null> {
  const doc = await openDocument(file);
  const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
  return toCanvasBox(page.getViewport({ scale }), box);
}
