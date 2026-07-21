/**
 * Reducing a Zotero highlight's rectangles to the single rect PDF++ links accept.
 *
 * Zotero stores one rectangle per *line* of a highlight. PDF++'s `rect=` link
 * parameter takes exactly one. The naive reduction -- a bounding box around all
 * of them -- is catastrophic for highlights that wrap between columns: the union
 * of "bottom of the left column" and "top of the right column" is most of the
 * page. Measured across this library (see zotero-automations,
 * src/core/minimap.ts), that made 18% of highlights draw a box more than twice
 * the text they marked, worst case 74x.
 *
 * So we group the rects into runs that plausibly belong to the same column and
 * box only the largest run. Within a column a bounding box *is* correct -- it is
 * a stack of adjacent lines -- which is why this is safe where the naive version
 * was not.
 *
 * Coordinates throughout are PDF user space: `[x0, y0, x1, y1]` with y
 * increasing upward. That is byte-compatible with PDF++'s `left,bottom,right,top`,
 * so nothing is transformed here, only selected.
 */

/** A Zotero rect, `[x0, y0, x1, y1]`, in either corner order. */
export type Rect = readonly number[];

/** A normalised box: `[left, bottom, right, top]`, left<=right, bottom<=top. */
export type Box = [number, number, number, number];

/** Two rects are in the same column if they overlap horizontally by this much
 *  of the narrower one. Generous, because a highlight's last line is short. */
const X_OVERLAP_FRACTION = 0.5;

/** A vertical gap wider than this many line-heights ends a run. Catches a jump
 *  to another column, or to a distant part of the same one. */
const VERTICAL_GAP_LINES = 2;

/** If the chosen run's box exceeds its own lines' area by more than this, the
 *  grouping did not help and a single line is the more honest answer. */
const BBOX_SLACK = 2.5;

function normalise(rect: Rect): Box | null {
  if (rect.length < 4) return null;
  const [a, b, c, d] = [rect[0]!, rect[1]!, rect[2]!, rect[3]!];
  if (![a, b, c, d].every(Number.isFinite)) return null;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

function area(box: Box): number {
  return (box[2] - box[0]) * (box[3] - box[1]);
}

function union(boxes: Box[]): Box {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

/** Do these two boxes share enough x-range to be lines of one column? */
function sameColumn(a: Box, b: Box): boolean {
  const overlap = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  if (overlap <= 0) return false;
  const narrower = Math.min(a[2] - a[0], b[2] - b[0]);
  // A zero-width rect can't be judged by overlap fraction; any overlap will do.
  return narrower <= 0 || overlap >= narrower * X_OVERLAP_FRACTION;
}

/** Is `next` close enough below `prev` to be the following line? */
function adjacentBelow(prev: Box, next: Box): boolean {
  const lineHeight = Math.max(prev[3] - prev[1], next[3] - next[1]);
  if (lineHeight <= 0) return true;
  const gap = prev[1] - next[3]; // negative when they overlap vertically
  return gap <= lineHeight * VERTICAL_GAP_LINES;
}

/**
 * The best single rect for a highlight, or null if it has no usable geometry.
 *
 * Returns `[left, bottom, right, top]` ready to interpolate into a PDF++ link.
 */
export function groupedRect(rects: readonly Rect[] | undefined): Box | null {
  const boxes: Box[] = [];
  for (const rect of rects ?? []) {
    const box = normalise(rect);
    if (box) boxes.push(box);
  }
  if (boxes.length === 0) return null;
  if (boxes.length === 1) return boxes[0]!;

  // Reading order: top of the page first.
  boxes.sort((a, b) => b[3] - a[3]);

  const runs: Box[][] = [];
  let run: Box[] = [boxes[0]!];
  for (let i = 1; i < boxes.length; i++) {
    const prev = boxes[i - 1]!;
    const box = boxes[i]!;
    if (sameColumn(prev, box) && adjacentBelow(prev, box)) {
      run.push(box);
    } else {
      runs.push(run);
      run = [box];
    }
  }
  runs.push(run);

  // The run covering the most marked text is the one worth pointing at.
  let best = runs[0]!;
  let bestArea = best.reduce((sum, b) => sum + area(b), 0);
  for (const candidate of runs.slice(1)) {
    const candidateArea = candidate.reduce((sum, b) => sum + area(b), 0);
    if (candidateArea > bestArea) {
      best = candidate;
      bestArea = candidateArea;
    }
  }

  const box = union(best);
  // Last line of defence: if the box still dwarfs the text inside it, the
  // grouping was wrong about something. One real line beats a wrong box.
  if (bestArea > 0 && area(box) > bestArea * BBOX_SLACK) return best[0]!;
  return box;
}

/** Never divide by a degenerate box. */
const MIN_EXTENT_PT = 1;

/**
 * The zoom at which a highlight fills `fill` of the popover.
 *
 * A fixed scale cannot work: highlights range from a few words to most of a
 * column, so one value either crops the long ones or renders the short ones
 * uselessly small. `box` is in PDF points and the viewport in CSS pixels, so the
 * ratio between them *is* the scale.
 *
 * Expressed as a fraction of the viewport rather than a margin in points,
 * because only one axis is ever binding — for single-column text that is almost
 * always the width — and a margin applied to the *other* axis changes nothing at
 * all. A fraction acts on whichever axis is actually constraining.
 *
 * Surrounding context does not need reserving: the whole page is rendered and
 * the popover is a scrollable window centred on the highlight, so whatever room
 * is left over is already filled with the surrounding page.
 *
 * Clamped at both ends — `max` stops a three-word highlight being blown up to
 * fill the popover, `min` stops a page-long one shrinking past readability
 * (past which scrolling a larger render is the better answer).
 */
export function fitScale(
  box: Box,
  viewportWidth: number,
  viewportHeight: number,
  min: number,
  max: number,
  fill: number,
): number {
  const width = Math.max(box[2] - box[0], MIN_EXTENT_PT);
  const height = Math.max(box[3] - box[1], MIN_EXTENT_PT);
  const scale = Math.min(
    (viewportWidth * fill) / width,
    (viewportHeight * fill) / height,
  );
  if (!Number.isFinite(scale)) return max;
  return Math.min(Math.max(scale, min), max);
}

/** `left,bottom,right,top` for a link, trimmed to sub-point precision. */
export function formatRect(box: Box): string {
  return box.map((n) => Math.round(n * 100) / 100).join(',');
}
