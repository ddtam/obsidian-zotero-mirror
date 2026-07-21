var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ZoteroMirrorPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian7 = require("obsidian");

// src/highlights.ts
var import_obsidian = require("obsidian");
var ANCHORED_LINE = /\^([A-Z0-9]{8})\s*$/;
var BACKLINK_SUFFIX = /\s*\(\[[^\]]*\]\(zotero:\/\/[^)]*\)\)\s*\^[A-Z0-9]{8}\s*$/;
var PAGE_LABEL = /\(\[pg\s*([^\]]*)\]\(zotero:\/\//;
var LEADING_MARKUP = /^[\t >]*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+)?/;
var COLOUR_SPAN = /<\/?span[^>]*>/g;
var IMAGE_EMBED = /!\[\[[^\]]*\]\]/g;
var COMMENT_LINE = /^[\t ]*>+\s?(.*)$/;
var HighlightIndex = class {
  constructor(app, settings, tracked) {
    this.app = app;
    this.settings = settings;
    this.tracked = tracked;
    this.byFile = /* @__PURE__ */ new Map();
    this.dirty = /* @__PURE__ */ new Set();
    this.built = false;
  }
  /** Re-parse changed notes lazily; a burst of imports costs one parse each. */
  registerEvents(plugin) {
    plugin.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (this.tracked.isSourceNote(file))
          this.dirty.add(file.path);
      })
    );
    plugin.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.byFile.delete(file.path);
        this.dirty.delete(file.path);
      })
    );
    plugin.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.byFile.delete(oldPath);
        this.dirty.delete(oldPath);
        if (this.tracked.isSourceNote(file))
          this.dirty.add(file.path);
      })
    );
  }
  async all() {
    await this.ensure();
    const out = [];
    for (const entries of this.byFile.values())
      out.push(...entries);
    return out;
  }
  async ensure() {
    if (!this.built) {
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (this.tracked.isSourceNote(file))
          this.dirty.add(file.path);
      }
      this.built = true;
    }
    if (this.dirty.size === 0)
      return;
    const paths = [...this.dirty];
    this.dirty.clear();
    for (const path2 of paths) {
      const file = this.app.vault.getAbstractFileByPath(path2);
      if (file instanceof import_obsidian.TFile)
        await this.parse(file);
      else
        this.byFile.delete(path2);
    }
  }
  async parse(file) {
    var _a2, _b, _c;
    let content;
    try {
      content = await this.app.vault.cachedRead(file);
    } catch (e) {
      this.byFile.delete(file.path);
      return;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const citekey = (_a2 = frontmatterString(cache, this.settings.citekeyProperty)) != null ? _a2 : "";
    const citation = shortCitation(cache, file);
    const lines = content.split("\n");
    const entries = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const anchor = line.match(ANCHORED_LINE);
      if (!anchor)
        continue;
      const commentParts = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (ANCHORED_LINE.test(next))
          break;
        const comment = next.match(COMMENT_LINE);
        if (!comment) {
          if (next.trim() === "")
            continue;
          break;
        }
        commentParts.push(comment[1].trim());
      }
      entries.push({
        key: anchor[1],
        text: cleanHighlight(line),
        comment: commentParts.join(" ").trim(),
        pageLabel: ((_c = (_b = line.match(PAGE_LABEL)) == null ? void 0 : _b[1]) != null ? _c : "").trim(),
        file,
        citekey,
        citation
      });
    }
    this.byFile.set(file.path, entries);
  }
};
function displayText(entry) {
  if (entry.text)
    return entry.text;
  return entry.comment || "[image]";
}
function cleanHighlight(line) {
  return line.replace(BACKLINK_SUFFIX, "").replace(LEADING_MARKUP, "").replace(COLOUR_SPAN, "").replace(IMAGE_EMBED, "").trim();
}
function frontmatterString(cache, key) {
  var _a2;
  const raw = (_a2 = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _a2[key];
  if (raw === void 0 || raw === null)
    return null;
  const value = String(raw).trim();
  return value ? value : null;
}
function shortCitation(cache, file) {
  var _a2, _b;
  const override = frontmatterString(cache, "shortcite");
  if (override)
    return override;
  const raw = (_a2 = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _a2.authors;
  const authors = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((a) => surnameOf(String(a))).filter((a) => !!a);
  const year = (_b = frontmatterString(cache, "year")) != null ? _b : "";
  let names;
  if (authors.length === 0)
    names = file.basename;
  else if (authors.length === 1)
    names = authors[0];
  else if (authors.length === 2)
    names = `${authors[0]} & ${authors[1]}`;
  else
    names = `${authors[0]} et al.`;
  return year ? `${names} ${year}` : names;
}
function surnameOf(author) {
  const inner = author.replace(/^\s*"?\[\[/, "").replace(/\]\]"?\s*$/, "");
  const surname = inner.split(",")[0].trim();
  return surname || null;
}

// src/hover.ts
var import_obsidian3 = require("obsidian");

// src/pdfrender.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var import_obsidian2 = require("obsidian");
var MAX_CACHED_DOCUMENTS = 3;
var HIGHLIGHT_ALPHA = 0.33;
var DEFAULT_HIGHLIGHT_COLOUR = "#ffd400";
var pdfjsPromise = null;
function pdfjs() {
  if (!pdfjsPromise)
    pdfjsPromise = (0, import_obsidian2.loadPdfJs)();
  return pdfjsPromise;
}
var documents = /* @__PURE__ */ new Map();
function findPdf(dataDir, attachmentKey) {
  const dir = path.join(dataDir, "storage", attachmentKey);
  try {
    const entry = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith(".pdf"));
    return entry ? path.join(dir, entry) : null;
  } catch (e) {
    return null;
  }
}
function openDocument(file) {
  const cached = documents.get(file);
  if (cached)
    return cached;
  const opening = (async () => {
    const lib = await pdfjs();
    const data = new Uint8Array(fs.readFileSync(file));
    return lib.getDocument({ data }).promise;
  })();
  documents.set(file, opening);
  if (documents.size > MAX_CACHED_DOCUMENTS) {
    const oldest = documents.keys().next().value;
    if (oldest !== void 0 && oldest !== file) {
      const stale = documents.get(oldest);
      documents.delete(oldest);
      void (stale == null ? void 0 : stale.then((d) => {
        var _a2;
        return (_a2 = d == null ? void 0 : d.destroy) == null ? void 0 : _a2.call(d);
      }).catch(() => {
      }));
    }
  }
  opening.catch(() => documents.delete(file));
  return opening;
}
function releaseDocuments() {
  for (const pending of documents.values()) {
    void pending.then((d) => {
      var _a2;
      return (_a2 = d == null ? void 0 : d.destroy) == null ? void 0 : _a2.call(d);
    }).catch(() => {
    });
  }
  documents.clear();
}
async function renderPage(file, pageNumber, scale, rects, colour) {
  const doc = await openDocument(file);
  const clamped = Math.min(Math.max(1, pageNumber), doc.numPages);
  const page = await doc.getPage(clamped);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx)
    throw new Error("could not get a 2d canvas context");
  await page.render({ canvasContext: ctx, viewport }).promise;
  ctx.save();
  ctx.globalAlpha = HIGHLIGHT_ALPHA;
  ctx.fillStyle = colour || DEFAULT_HIGHLIGHT_COLOUR;
  let target = null;
  for (const rect of rects) {
    const box = toCanvasBox(viewport, rect);
    if (!box)
      continue;
    ctx.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    target = target ? mergeBox(target, box) : box;
  }
  ctx.restore();
  return { canvas, target };
}
function toCanvasBox(viewport, rect) {
  if (rect.length < 4)
    return null;
  if (!rect.slice(0, 4).every((n) => Number.isFinite(n)))
    return null;
  const [a, b, c, d] = viewport.convertToViewportRectangle([
    rect[0],
    rect[1],
    rect[2],
    rect[3]
  ]);
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}
function mergeBox(x, y) {
  return [
    Math.min(x[0], y[0]),
    Math.min(x[1], y[1]),
    Math.max(x[2], y[2]),
    Math.max(x[3], y[3])
  ];
}
async function boxToCanvas(file, pageNumber, scale, box) {
  const doc = await openDocument(file);
  const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
  return toCanvasBox(page.getViewport({ scale }), box);
}

// src/rects.ts
var X_OVERLAP_FRACTION = 0.5;
var VERTICAL_GAP_LINES = 2;
var BBOX_SLACK = 2.5;
function normalise(rect) {
  if (rect.length < 4)
    return null;
  const [a, b, c, d] = [rect[0], rect[1], rect[2], rect[3]];
  if (![a, b, c, d].every(Number.isFinite))
    return null;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}
function area(box) {
  return (box[2] - box[0]) * (box[3] - box[1]);
}
function union(boxes) {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3]))
  ];
}
function sameColumn(a, b) {
  const overlap = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  if (overlap <= 0)
    return false;
  const narrower = Math.min(a[2] - a[0], b[2] - b[0]);
  return narrower <= 0 || overlap >= narrower * X_OVERLAP_FRACTION;
}
function adjacentBelow(prev, next) {
  const lineHeight = Math.max(prev[3] - prev[1], next[3] - next[1]);
  if (lineHeight <= 0)
    return true;
  const gap = prev[1] - next[3];
  return gap <= lineHeight * VERTICAL_GAP_LINES;
}
function groupedRect(rects) {
  const boxes = [];
  for (const rect of rects != null ? rects : []) {
    const box2 = normalise(rect);
    if (box2)
      boxes.push(box2);
  }
  if (boxes.length === 0)
    return null;
  if (boxes.length === 1)
    return boxes[0];
  boxes.sort((a, b) => b[3] - a[3]);
  const runs = [];
  let run = [boxes[0]];
  for (let i = 1; i < boxes.length; i++) {
    const prev = boxes[i - 1];
    const box2 = boxes[i];
    if (sameColumn(prev, box2) && adjacentBelow(prev, box2)) {
      run.push(box2);
    } else {
      runs.push(run);
      run = [box2];
    }
  }
  runs.push(run);
  let best = runs[0];
  let bestArea = best.reduce((sum, b) => sum + area(b), 0);
  for (const candidate of runs.slice(1)) {
    const candidateArea = candidate.reduce((sum, b) => sum + area(b), 0);
    if (candidateArea > bestArea) {
      best = candidate;
      bestArea = candidateArea;
    }
  }
  const box = union(best);
  if (bestArea > 0 && area(box) > bestArea * BBOX_SLACK)
    return best[0];
  return box;
}
var MIN_EXTENT_PT = 1;
function fitScale(box, viewportWidth, viewportHeight, min, max, fill) {
  const width = Math.max(box[2] - box[0], MIN_EXTENT_PT);
  const height = Math.max(box[3] - box[1], MIN_EXTENT_PT);
  const scale = Math.min(
    viewportWidth * fill / width,
    viewportHeight * fill / height
  );
  if (!Number.isFinite(scale))
    return max;
  return Math.min(Math.max(scale, min), max);
}

// src/hover.ts
var HighlightHover = class {
  constructor(app, settings, positions) {
    this.app = app;
    this.settings = settings;
    this.positions = positions;
    this.hoverPopover = null;
    /** The link the visible popover belongs to, so re-entering does not rebuild. */
    this.current = null;
  }
  /** Repoint after the Zotero client is rebuilt (host/port change). */
  setPositions(positions) {
    this.positions = positions;
  }
  registerEvents(plugin) {
    plugin.registerDomEvent(document, "mouseover", (evt) => {
      const anchor = zoteroAnchorFrom(evt.target);
      if (!anchor) {
        this.current = null;
        return;
      }
      if (!this.settings.hoverPreviews)
        return;
      if (this.settings.hoverRequiresModKey && !(evt.ctrlKey || evt.metaKey))
        return;
      if (anchor === this.current)
        return;
      this.current = anchor;
      void this.show(anchor);
    });
  }
  async show(anchor) {
    var _a2, _b, _c, _d;
    const link = parseZoteroLink((_a2 = anchor.getAttribute("href")) != null ? _a2 : "");
    if (!link)
      return;
    const file = findPdf(this.settings.zoteroDataDir, link.attachmentKey);
    if (!file)
      return;
    let position = link.annotationKey ? this.positions.get(link.annotationKey) : void 0;
    if (!position && link.annotationKey) {
      await this.positions.ensure();
      if (this.current !== anchor)
        return;
      position = this.positions.get(link.annotationKey);
    }
    const pageNumber = position !== void 0 ? position.pageIndex + 1 : (_b = link.page) != null ? _b : 1;
    const focus = position ? groupedRect(position.rects) : null;
    const scale = focus ? fitScale(
      focus,
      this.settings.hoverPopoverWidth,
      this.settings.hoverPopoverHeight,
      this.settings.hoverMinScale,
      this.settings.hoverMaxScale,
      this.settings.hoverFill
    ) : this.settings.hoverMaxScale;
    if (this.settings.hoverDebug) {
      console.log("[zotero-mirror] preview", {
        annotation: link.annotationKey,
        positionFound: position !== void 0,
        rects: (_c = position == null ? void 0 : position.rects.length) != null ? _c : 0,
        focusPt: focus ? `${(focus[2] - focus[0]).toFixed(0)}x${(focus[3] - focus[1]).toFixed(0)}` : null,
        settings: {
          fill: this.settings.hoverFill,
          viewport: `${this.settings.hoverPopoverWidth}x${this.settings.hoverPopoverHeight}`,
          clamp: `${this.settings.hoverMinScale}..${this.settings.hoverMaxScale}`
        },
        scale: Number(scale.toFixed(3)),
        clampedAtMax: scale === this.settings.hoverMaxScale,
        clampedAtMin: scale === this.settings.hoverMinScale
      });
    }
    if (this.current !== anchor)
      return;
    let rendered;
    try {
      rendered = await renderPage(
        file,
        pageNumber,
        scale,
        (_d = position == null ? void 0 : position.rects) != null ? _d : [],
        position == null ? void 0 : position.color
      );
    } catch (e) {
      console.error("[zotero-mirror] failed to render PDF preview", e);
      return;
    }
    if (this.current !== anchor)
      return;
    const scrollTo = focus ? await this.focusBox(file, pageNumber, focus, scale) : rendered.target;
    this.build(anchor, rendered.canvas, scrollTo);
  }
  async focusBox(file, pageNumber, box, scale) {
    try {
      return await boxToCanvas(
        file,
        pageNumber,
        scale,
        box
      );
    } catch (e) {
      return null;
    }
  }
  build(anchor, canvas, focus) {
    const popover = new import_obsidian3.HoverPopover(this, anchor);
    const { hoverPopoverWidth, hoverPopoverHeight } = this.settings;
    const el = popover.hoverEl;
    el.style.setProperty("width", `${hoverPopoverWidth}px`, "important");
    el.style.setProperty("max-width", `${hoverPopoverWidth}px`, "important");
    el.style.setProperty("padding", "0", "important");
    el.style.setProperty("max-height", `${hoverPopoverHeight}px`, "important");
    const scroller = el.createDiv();
    scroller.style.overflow = "auto";
    scroller.style.width = "100%";
    scroller.style.height = `${hoverPopoverHeight}px`;
    canvas.style.display = "block";
    scroller.appendChild(canvas);
    enableDragScroll(scroller);
    if (focus)
      centreOn(scroller, focus);
  }
};
function enableDragScroll(el) {
  el.style.cursor = "grab";
  el.style.userSelect = "none";
  let panning = false;
  let originX = 0;
  let originY = 0;
  let fromLeft = 0;
  let fromTop = 0;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0)
      return;
    panning = true;
    originX = e.clientX;
    originY = e.clientY;
    fromLeft = el.scrollLeft;
    fromTop = el.scrollTop;
    el.setPointerCapture(e.pointerId);
    el.style.cursor = "grabbing";
    e.preventDefault();
  });
  el.addEventListener("pointermove", (e) => {
    if (!panning)
      return;
    el.scrollLeft = fromLeft - (e.clientX - originX);
    el.scrollTop = fromTop - (e.clientY - originY);
  });
  const release = (e) => {
    if (!panning)
      return;
    panning = false;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch (e2) {
    }
    el.style.cursor = "grab";
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
}
var LAYOUT_TIMEOUT_MS = 3e3;
function centreOn(scroller, box) {
  const apply = () => {
    const height = scroller.clientHeight;
    const width = scroller.clientWidth;
    if (!height || !width)
      return false;
    const midY = (box[1] + box[3]) / 2;
    const midX = (box[0] + box[2]) / 2;
    scroller.scrollTop = clamp(midY - height / 2, scroller.scrollHeight - height);
    scroller.scrollLeft = clamp(midX - width / 2, scroller.scrollWidth - width);
    return true;
  };
  if (apply())
    return;
  const observer = new ResizeObserver(() => {
    if (apply())
      observer.disconnect();
  });
  observer.observe(scroller);
  window.setTimeout(() => observer.disconnect(), LAYOUT_TIMEOUT_MS);
}
function clamp(value, max) {
  return Math.max(0, Math.min(value, Math.max(0, max)));
}
function zoteroAnchorFrom(target) {
  var _a2;
  if (!(target instanceof HTMLElement))
    return null;
  const anchor = target.closest("a");
  if (!(anchor instanceof HTMLAnchorElement))
    return null;
  const href = (_a2 = anchor.getAttribute("href")) != null ? _a2 : "";
  return href.startsWith("zotero://open-pdf") ? anchor : null;
}
function parseZoteroLink(href) {
  const item = href.match(/\/items\/([A-Z0-9]+)/i);
  if (!item)
    return null;
  const page = href.match(/[?&]page=(\d+)/i);
  const annotation = href.match(/[?&]annotation=([A-Z0-9]+)/i);
  return {
    attachmentKey: item[1],
    annotationKey: annotation ? annotation[1] : null,
    page: page ? parseInt(page[1], 10) : null
  };
}

// src/linkfix.ts
var CitekeyLinkResolver = class {
  constructor(app, settings, tracked) {
    this.app = app;
    this.settings = settings;
    this.tracked = tracked;
    this.timers = /* @__PURE__ */ new Map();
  }
  registerEvents(plugin) {
    plugin.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (!this.settings.enabledOnThisDevice)
          return;
        if (!this.settings.resolveCitekeyLinks)
          return;
        if (!this.tracked.isSourceNote(file))
          return;
        this.schedule(file);
      })
    );
    plugin.register(() => {
      for (const handle of this.timers.values())
        window.clearTimeout(handle);
      this.timers.clear();
    });
  }
  /** Coalesce edits so we rewrite once things settle, not mid-keystroke. */
  schedule(file) {
    const existing = this.timers.get(file.path);
    if (existing)
      window.clearTimeout(existing);
    this.timers.set(
      file.path,
      window.setTimeout(() => {
        this.timers.delete(file.path);
        void this.fixup(file);
      }, DEBOUNCE_MS)
    );
  }
  /** Returns true if the file was rewritten. */
  async fixup(file) {
    if (!this.settings.resolveCitekeyLinks)
      return false;
    if (!this.tracked.isSourceNote(file))
      return false;
    let before;
    try {
      before = await this.app.vault.cachedRead(file);
    } catch (e) {
      return false;
    }
    const after = this.rewrite(before, file.path);
    if (after === before)
      return false;
    await this.app.vault.modify(file, after);
    return true;
  }
  /** Every source note at once — for turning the feature on retroactively. */
  async sweep() {
    let changed = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.tracked.isSourceNote(file))
        continue;
      if (await this.fixup(file))
        changed++;
    }
    return changed;
  }
  rewrite(content, sourcePath) {
    return content.replace(WIKILINK, (whole, target, anchor) => {
      const citekey = target.trim();
      const file = this.tracked.fileFor(citekey);
      if (!file)
        return whole;
      if (file.path === sourcePath)
        return whole;
      const linktext = this.app.metadataCache.fileToLinktext(file, sourcePath, true);
      if (linktext === citekey)
        return whole;
      return `[[${linktext}${anchor}|${citekey}]]`;
    });
  }
};
var DEBOUNCE_MS = 1500;
var WIKILINK = /\[\[([^\[\]|#]+)((?:#[^\[\]|]*)?)\]\]/g;

// src/picker.ts
var import_obsidian4 = require("obsidian");
var HighlightReferenceInserter = class {
  constructor(app, settings, highlights, positions) {
    this.app = app;
    this.settings = settings;
    this.highlights = highlights;
    this.positions = positions;
  }
  /** Prompt for a highlight and insert a reference to it at the cursor. */
  async run() {
    var _a2;
    const editor = (_a2 = this.app.workspace.activeEditor) == null ? void 0 : _a2.editor;
    if (!editor) {
      new import_obsidian4.Notice("Zotero Mirror: open a note to insert into first.");
      return;
    }
    const entries = await this.highlights.all();
    if (entries.length === 0) {
      new import_obsidian4.Notice(
        "Zotero Mirror: no highlights found. Notes need block anchors \u2014 re-import to add them."
      );
      return;
    }
    void this.positions.ensure();
    new HighlightPicker(this.app, entries, (entry) => {
      void this.insert(entry);
    }).open();
  }
  async insert(entry) {
    var _a2, _b, _c, _d;
    const editor = (_a2 = this.app.workspace.activeEditor) == null ? void 0 : _a2.editor;
    if (!editor)
      return;
    const sourcePath = (_d = (_c = (_b = this.app.workspace.activeEditor) == null ? void 0 : _b.file) == null ? void 0 : _c.path) != null ? _d : "";
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
  async buildReference(entry, sourcePath) {
    const note = this.app.metadataCache.fileToLinktext(entry.file, sourcePath, true);
    const base = {
      note,
      cite: entry.citation,
      key: entry.key,
      quote: displayText(entry),
      pageLabel: entry.pageLabel
    };
    const target = await this.resolveZoteroTarget(entry);
    if (target) {
      return render(this.settings.highlightInsertTemplate, { ...base, ...target });
    }
    return render(this.settings.highlightFallbackTemplate, {
      ...base,
      attachment: "",
      page: ""
    });
  }
  /**
   * The attachment and physical page a highlight lives on.
   *
   * Both come from Zotero's API rather than the note: the note's page label is
   * the page *printed* on the paper (a journal article might read "2213" on
   * physical page 5), so it can never be used to address a PDF.
   */
  async resolveZoteroTarget(entry) {
    if (!await this.positions.ensure())
      return null;
    const position = this.positions.get(entry.key);
    if (!position)
      return null;
    return {
      attachment: position.attachmentKey,
      // pageIndex is 0-based; the link is 1-based.
      page: String(position.pageIndex + 1)
    };
  }
};
function render(template, values) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (whole, name) => name in values ? values[name] : whole
  );
}
var SUGGESTION_LIMIT = 50;
var META_MATCH_PENALTY = 1;
function rankHighlights(entries, query, makeSearch) {
  const tokens = query.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0)
    return entries.slice(0, SUGGESTION_LIMIT);
  const searches = tokens.map((token) => makeSearch(token));
  const scored = [];
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
        inMeta ? inMeta.score - META_MATCH_PENALTY : -Infinity
      );
    }
    if (matchedAll)
      scored.push({ entry, score: total });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, SUGGESTION_LIMIT).map((s) => s.entry);
}
var HighlightPicker = class extends import_obsidian4.SuggestModal {
  constructor(app, entries, onChoose) {
    super(app);
    this.entries = entries;
    this.onChoose = onChoose;
    this.limit = SUGGESTION_LIMIT;
    this.setPlaceholder("Search highlights by text, author or citekey\u2026");
  }
  getSuggestions(query) {
    return rankHighlights(this.entries, query, import_obsidian4.prepareFuzzySearch);
  }
  renderSuggestion(entry, el) {
    el.createDiv({ text: displayText(entry) });
    const meta = entry.pageLabel ? `${entry.citation} \xB7 pg ${entry.pageLabel}` : entry.citation;
    el.createDiv({ text: meta, cls: "setting-item-description" });
  }
  onChooseSuggestion(entry) {
    this.onChoose(entry);
  }
};

// src/positions.ts
var CACHE_FILE = "positions.json";
var RETRY_COOLDOWN_MS = 6e4;
var PositionIndex = class {
  constructor(client, plugin) {
    this.client = client;
    this.plugin = plugin;
    this.byAnnotation = /* @__PURE__ */ new Map();
    this.loaded = false;
    this.loading = null;
    this.dirty = false;
    this.lastFailure = 0;
  }
  /**
   * Load the cache written by a previous session.
   *
   * Hover previews have to work with Zotero closed — that is the common case
   * while writing — and geometry only reaches us through Zotero's API, so
   * without this the feature would silently depend on Zotero running.
   */
  async loadCache() {
    if (!this.plugin)
      return;
    const path2 = `${this.plugin.manifest.dir}/${CACHE_FILE}`;
    try {
      const adapter = this.plugin.app.vault.adapter;
      if (!await adapter.exists(path2))
        return;
      const raw = JSON.parse(await adapter.read(path2));
      for (const [key, value] of Object.entries(raw)) {
        if (value && typeof value.pageIndex === "number")
          this.byAnnotation.set(key, value);
      }
    } catch (e) {
      console.warn("[zotero-mirror] could not read the position cache", e);
    }
  }
  /** Persist, if anything changed since the last write. */
  async saveCache() {
    if (!this.plugin || !this.dirty)
      return;
    this.dirty = false;
    const path2 = `${this.plugin.manifest.dir}/${CACHE_FILE}`;
    try {
      await this.plugin.app.vault.adapter.write(
        path2,
        JSON.stringify(Object.fromEntries(this.byAnnotation))
      );
    } catch (e) {
      console.warn("[zotero-mirror] could not write the position cache", e);
    }
  }
  get(annotationKey) {
    return this.byAnnotation.get(annotationKey);
  }
  size() {
    return this.byAnnotation.size;
  }
  /**
   * Load the whole library's annotation geometry, once per session.
   *
   * Returns false when Zotero is unreachable — callers fall back to note-block
   * links rather than failing, so a closed Zotero degrades the output instead of
   * breaking the command.
   */
  async ensure() {
    if (this.loaded)
      return true;
    if (Date.now() - this.lastFailure < RETRY_COOLDOWN_MS)
      return false;
    if (!this.loading) {
      this.loading = this.load().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }
  async load() {
    try {
      const items = await this.client.getAllAnnotations();
      for (const item of items)
        this.absorb(item);
      this.loaded = true;
      await this.saveCache();
      return true;
    } catch (e) {
      console.error("[zotero-mirror] failed to load annotation positions", e);
      this.lastFailure = Date.now();
      return false;
    }
  }
  /**
   * Record one annotation's position.
   *
   * Called both by the initial load and from the poll loop, which already sees
   * every changed annotation — so edits stay current for free, with no second
   * request and no invalidation logic.
   */
  absorb(item) {
    if (item.itemType !== "annotation")
      return;
    const position = parsePosition(item.annotationPosition);
    if (!position || !item.parentItem)
      return;
    this.dirty = true;
    this.byAnnotation.set(item.key, {
      // An annotation's parent is the attachment, whose key is also the name of
      // its folder under ~/Zotero/storage — which is how a highlight finds its
      // PDF file with no filesystem access.
      attachmentKey: item.parentItem,
      pageIndex: position.pageIndex,
      rects: position.rects,
      color: item.annotationColor
    });
  }
};
function parsePosition(raw) {
  if (!raw)
    return null;
  try {
    const parsed = JSON.parse(raw);
    const pageIndex = typeof parsed.pageIndex === "number" ? parsed.pageIndex : null;
    if (pageIndex === null)
      return null;
    const rects = Array.isArray(parsed.rects) ? parsed.rects.filter((r) => Array.isArray(r) && r.length >= 4) : [];
    return { pageIndex, rects };
  } catch (e) {
    return null;
  }
}

// src/settings.ts
var import_obsidian5 = require("obsidian");
var ZoteroMirrorSettingTab = class extends import_obsidian5.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  parseList(value) {
    return value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  }
  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();
    new import_obsidian5.Setting(containerEl).setName("Activation").setHeading();
    new import_obsidian5.Setting(containerEl).setName("Enable on this device").setDesc(
      "Only ONE device should have this on. If multiple LiveSync devices poll and import the same paper, they will write conflicting copies of the note."
    ).addToggle(
      (t) => t.setValue(s.enabledOnThisDevice).onChange(async (v) => {
        s.enabledOnThisDevice = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Import format").setDesc("Name of the Zotero Integration export format to drive (must exist there).").addText(
      (t) => t.setPlaceholder("Smart Import").setValue(s.exportFormatName).onChange(async (v) => {
        s.exportFormatName = v.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Timing").setHeading();
    new import_obsidian5.Setting(containerEl).setName("Poll interval (seconds)").setDesc("How often to check Zotero for changes.").addText(
      (t) => t.setValue(String(s.pollIntervalSeconds)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n >= 5) {
          s.pollIntervalSeconds = n;
          await this.plugin.saveSettings();
          this.plugin.restartPolling();
        }
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Quiet cooldown (seconds)").setDesc(
      "A paper is imported only after it has had no further changes for this long \u2014 batches a burst of highlights into one note write (LiveSync-friendly)."
    ).addText(
      (t) => t.setValue(String(s.quietCooldownSeconds)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n >= 0) {
          s.quietCooldownSeconds = n;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Scope").setHeading();
    new import_obsidian5.Setting(containerEl).setName("Item types for annotation imports").setDesc(
      "Comma-separated Zotero item types that get a NEW note when annotated (journal articles only by default, to avoid book-highlight noise). Tag-flagged items and updates to existing notes work for ANY type."
    ).addText(
      (t) => t.setValue(s.allowedItemTypes.join(", ")).onChange(async (v) => {
        s.allowedItemTypes = this.parseList(v);
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Stub trigger tags").setDesc(
      "Comma-separated Zotero tags that flag ANY item (book, paper, etc.) for import (status / priority emojis). Reuses your existing triage tags \u2014 works from Zotero mobile via sync."
    ).addText(
      (t) => t.setValue(s.stubTriggerTags.join(", ")).onChange(async (v) => {
        s.stubTriggerTags = this.parseList(v);
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Source folder").setDesc('Vault folder whose notes\u2019 citekeys mark a paper as "tracked".').addText(
      (t) => t.setValue(s.sourceFolder).onChange(async (v) => {
        s.sourceFolder = v.trim();
        await this.plugin.saveSettings();
        this.plugin.tracked.rebuild();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Citekey property").setDesc("Frontmatter property holding the Better BibTeX citekey.").addText(
      (t) => t.setValue(s.citekeyProperty).onChange(async (v) => {
        s.citekeyProperty = v.trim() || "citekey";
        await this.plugin.saveSettings();
        this.plugin.tracked.rebuild();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Highlight references").setHeading();
    new import_obsidian5.Setting(containerEl).setName("PDF preview on hover").setDesc(
      "Hovering a zotero:// link renders that PDF page with its highlights drawn on it. Read straight from Zotero\u2019s folder \u2014 no PDFs are copied into the vault. Desktop only."
    ).addToggle(
      (t) => t.setValue(s.hoverPreviews).onChange(async (v) => {
        s.hoverPreviews = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Zotero data directory").setDesc("Attachments are read from <dir>/storage/<key>/. Usually ~/Zotero.").addText(
      (t) => t.setValue(s.zoteroDataDir).onChange(async (v) => {
        s.zoteroDataDir = v.trim().replace(/\/+$/, "");
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Require ctrl/cmd for preview").setDesc("Only show the PDF preview while a modifier is held.").addToggle(
      (t) => t.setValue(s.hoverRequiresModKey).onChange(async (v) => {
        s.hoverRequiresModKey = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Preview size").setDesc(
      "Width and height of the preview in pixels. The zoom is fitted to these, so a larger preview shows more of the page rather than a bigger crop of it."
    ).addText(
      (t) => t.setPlaceholder("width").setValue(String(s.hoverPopoverWidth)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n >= 200) {
          s.hoverPopoverWidth = n;
          await this.plugin.saveSettings();
        }
      })
    ).addText(
      (t) => t.setPlaceholder("height").setValue(String(s.hoverPopoverHeight)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n >= 100) {
          s.hoverPopoverHeight = n;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Highlight fill").setDesc(
      "How much of the preview the highlight should take up, 0\u20131. Raise it to zoom in tighter, lower it to see more of the page around it. Surrounding context is not lost either way: the whole page is rendered and the preview scrolls."
    ).addText(
      (t) => t.setValue(String(s.hoverFill)).onChange(async (v) => {
        const n = parseFloat(v);
        if (!isNaN(n) && n > 0 && n <= 1) {
          s.hoverFill = n;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Log preview zoom decisions").setDesc(
      "Print how each preview chose its zoom to the developer console (ctrl+shift+i). For working out why a size setting is not having the effect you expect."
    ).addToggle(
      (t) => t.setValue(s.hoverDebug).onChange(async (v) => {
        s.hoverDebug = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Zoom limits").setDesc(
      "Minimum and maximum zoom. Each highlight is zoomed to fit the preview: the minimum stops a page-long highlight shrinking past readability (scroll instead), the maximum stops a three-word one being magnified to fill the box."
    ).addText(
      (t) => t.setPlaceholder("min").setValue(String(s.hoverMinScale)).onChange(async (v) => {
        const n = parseFloat(v);
        if (!isNaN(n) && n > 0 && n <= 5) {
          s.hoverMinScale = n;
          await this.plugin.saveSettings();
        }
      })
    ).addText(
      (t) => t.setPlaceholder("max").setValue(String(s.hoverMaxScale)).onChange(async (v) => {
        const n = parseFloat(v);
        if (!isNaN(n) && n > 0 && n <= 8) {
          s.hoverMaxScale = n;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Reference template").setDesc(
      "Used when Zotero knows where the highlight is. Placeholders: {{attachment}} {{page}} {{note}} {{cite}} {{key}} {{quote}} {{pageLabel}}"
    ).addTextArea(
      (t) => t.setValue(s.highlightInsertTemplate).onChange(async (v) => {
        s.highlightInsertTemplate = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Reference template (fallback)").setDesc(
      "Used when Zotero has never been reached, so no attachment is known. Links to the note\u2019s block anchor instead \u2014 no PDF preview, but it works on mobile."
    ).addTextArea(
      (t) => t.setValue(s.highlightFallbackTemplate).onChange(async (v) => {
        s.highlightFallbackTemplate = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Citekey links").setHeading();
    new import_obsidian5.Setting(containerEl).setName("Resolve citekey links").setDesc(
      "Rewrite bare [[citekey]] links in source notes so they resolve, keeping the citekey as the displayed text. Obsidian matches links by filename only and ignores aliases, so a citekey pasted into a Zotero comment otherwise imports as a broken link."
    ).addToggle(
      (t) => t.setValue(s.resolveCitekeyLinks).onChange(async (v) => {
        s.resolveCitekeyLinks = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Resolve existing notes").setDesc(
      "Apply the rewrite to every source note once. Not normally needed \u2014 with the toggle on, notes are rewritten as they change. Useful after turning it on, since the links live in Zotero comments and come back bare on every re-import."
    ).addButton(
      (b) => b.setButtonText("Resolve now").onClick(async () => {
        if (!s.resolveCitekeyLinks) {
          new import_obsidian5.Notice('Turn on "Resolve citekey links" first.');
          return;
        }
        const changed = await this.plugin.linkResolver.sweep();
        new import_obsidian5.Notice(`Zotero Mirror: rewrote links in ${changed} note(s).`);
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Zotero connection").setHeading();
    new import_obsidian5.Setting(containerEl).setName("Host").addText(
      (t) => t.setValue(s.zoteroHost).onChange(async (v) => {
        s.zoteroHost = v.trim() || "127.0.0.1";
        await this.plugin.saveSettings();
        this.plugin.applyConnectionSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Port").addText(
      (t) => t.setValue(String(s.zoteroPort)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n)) {
          s.zoteroPort = n;
          await this.plugin.saveSettings();
          this.plugin.applyConnectionSettings();
        }
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Library id").setDesc('BBT library id passed to runImport (1 = personal "My Library").').addText(
      (t) => t.setValue(String(s.libraryId)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n)) {
          s.libraryId = n;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Actions").setHeading();
    new import_obsidian5.Setting(containerEl).setName("Sync now").setDesc("Run one poll + import cycle immediately.").addButton(
      (b) => b.setButtonText("Sync now").onClick(async () => {
        if (!s.enabledOnThisDevice) {
          new import_obsidian5.Notice("Enable on this device first.");
          return;
        }
        new import_obsidian5.Notice("Zotero Mirror: syncing\u2026");
        await this.plugin.forceSync();
        new import_obsidian5.Notice(`Zotero Mirror: ${this.plugin.lastStatus}`);
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Backfill reading pile").setDesc(
      "One-time: import tagged journal articles that have no note yet (throttled)."
    ).addButton(
      (b) => b.setButtonText("Backfill\u2026").onClick(async () => {
        new import_obsidian5.Notice("Zotero Mirror: collecting candidates\u2026");
        let list;
        try {
          list = await this.plugin.collectBackfill();
        } catch (e) {
          new import_obsidian5.Notice("Zotero Mirror: failed to query Zotero (see console).");
          console.error(e);
          return;
        }
        if (list.length === 0) {
          new import_obsidian5.Notice("Zotero Mirror: nothing to backfill.");
          return;
        }
        new ConfirmModal(
          this.app,
          `Import ${list.length} tagged paper(s) with no note yet?`,
          "They will be imported one at a time (~2.5/sec) on this device.",
          async () => {
            const notice = new import_obsidian5.Notice(`Backfill: 0/${list.length}`, 0);
            const done = await this.plugin.runBackfill(list, (d, total) => {
              notice.setMessage(`Backfill: ${d}/${total}`);
            });
            notice.hide();
            new import_obsidian5.Notice(`Zotero Mirror: backfilled ${done}/${list.length}.`);
          }
        ).open();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Re-import all tracked notes").setDesc(
      "Re-render every note that already exists, to pick up template changes such as the highlight block anchors. Overwrites everything outside {% persist %} blocks and writes every note \u2014 LiveSync will replicate all of them."
    ).addButton(
      (b) => b.setButtonText("Re-import all\u2026").onClick(async () => {
        if (!s.enabledOnThisDevice) {
          new import_obsidian5.Notice("Enable on this device first.");
          return;
        }
        const list = this.plugin.collectTracked();
        if (list.length === 0) {
          new import_obsidian5.Notice("Zotero Mirror: no tracked notes.");
          return;
        }
        new ConfirmModal(
          this.app,
          `Re-import all ${list.length} tracked note(s)?`,
          "Each is re-rendered from Zotero (~2.5/sec). Content outside persist blocks is overwritten.",
          async () => {
            const notice = new import_obsidian5.Notice(`Re-import: 0/${list.length}`, 0);
            const done = await this.plugin.runBackfill(list, (d, total) => {
              notice.setMessage(`Re-import: ${d}/${total}`);
            });
            notice.hide();
            new import_obsidian5.Notice(`Zotero Mirror: re-imported ${done}/${list.length}.`);
          }
        ).open();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Reset baseline").setDesc(
      "Forget the backlog: set the tracking point to Zotero\u2019s current version. Future changes only."
    ).addButton(
      (b) => b.setWarning().setButtonText("Reset baseline").onClick(async () => {
        await this.plugin.resetBaseline();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Status").setHeading();
    containerEl.createEl("p", {
      text: `Tracked notes: ${this.plugin.tracked.size()} \xB7 Library version: ${s.lastLibraryVersion} \xB7 Last: ${this.plugin.lastStatus}`,
      cls: "setting-item-description"
    });
  }
};
var ConfirmModal = class extends import_obsidian5.Modal {
  constructor(app, title, body, onConfirm) {
    super(app);
    this.title = title;
    this.body = body;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });
    contentEl.createEl("p", { text: this.body });
    new import_obsidian5.Setting(contentEl).addButton(
      (b) => b.setButtonText("Import").setCta().onClick(async () => {
        this.close();
        await this.onConfirm();
      })
    ).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/tracked.ts
var import_obsidian6 = require("obsidian");
var TrackedIndex = class {
  constructor(app, settings) {
    this.app = app;
    this.settings = settings;
    /** Citekey -> the note that declares it. The note is needed to build links
     *  back to it, so this is a map rather than the set it started as. */
    this.byCitekey = /* @__PURE__ */ new Map();
  }
  has(citekey) {
    return this.byCitekey.has(citekey);
  }
  size() {
    return this.byCitekey.size;
  }
  /** The note for a citekey, if one is tracked. */
  fileFor(citekey) {
    return this.byCitekey.get(citekey);
  }
  /** Every tracked citekey, for sweeps and backfills. */
  citekeys() {
    return [...this.byCitekey.keys()];
  }
  /** True for markdown notes inside the configured source folder. */
  isSourceNote(file) {
    return file instanceof import_obsidian6.TFile && file.extension === "md" && (file.path === this.settings.sourceFolder || file.path.startsWith(this.settings.sourceFolder + "/"));
  }
  citekeyOf(cache) {
    var _a2;
    const raw = (_a2 = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _a2[this.settings.citekeyProperty];
    if (raw === void 0 || raw === null)
      return null;
    const key = String(raw).trim();
    return key ? key.replace(/^@/, "") : null;
  }
  /** Full rebuild from the metadata cache. */
  rebuild() {
    this.byCitekey.clear();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.isSourceNote(file))
        continue;
      const key = this.citekeyOf(this.app.metadataCache.getFileCache(file));
      if (key)
        this.byCitekey.set(key, file);
    }
  }
  /** Keep the index current as notes are written, deleted, or moved. */
  registerEvents(plugin) {
    plugin.registerEvent(
      this.app.metadataCache.on("changed", (file, _data, cache) => {
        if (!this.isSourceNote(file))
          return;
        const key = this.citekeyOf(cache);
        if (key)
          this.byCitekey.set(key, file);
      })
    );
    plugin.registerEvent(this.app.vault.on("delete", () => this.rebuild()));
    plugin.registerEvent(this.app.vault.on("rename", () => this.rebuild()));
  }
};

// src/types.ts
var DEFAULT_INSERT_TEMPLATE = "[in](zotero://open-pdf/library/items/{{attachment}}?page={{page}}&annotation={{key}}) [[{{note}}|{{cite}}]]";
var DEFAULT_FALLBACK_TEMPLATE = "[[{{note}}#^{{key}}|in]] [[{{note}}|{{cite}}]]";
var LEGACY_TEMPLATES = [
  // 0.3.0–0.3.1, italicised.
  "_[[{{pdf}}#page={{page}}&rect={{rect}}&color={{color}}|in]]_ _[[{{note}}|{{cite}}]]_",
  // 0.3.2–0.3.3, PDF++ links against a symlinked vault folder.
  "[[{{pdf}}#page={{page}}&rect={{rect}}&color={{color}}|in]] [[{{note}}|{{cite}}]]"
];
var LEGACY_FALLBACK_TEMPLATE = "_[[{{note}}#^{{key}}|in]]_ _[[{{note}}|{{cite}}]]_";
function migrateSettings(settings) {
  let changed = false;
  if (LEGACY_TEMPLATES.includes(settings.highlightInsertTemplate)) {
    settings.highlightInsertTemplate = DEFAULT_INSERT_TEMPLATE;
    changed = true;
  }
  if (settings.highlightFallbackTemplate === LEGACY_FALLBACK_TEMPLATE) {
    settings.highlightFallbackTemplate = DEFAULT_FALLBACK_TEMPLATE;
    changed = true;
  }
  for (const dead of DEAD_KEYS) {
    if (dead in settings) {
      delete settings[dead];
      changed = true;
    }
  }
  return changed;
}
var DEAD_KEYS = ["hoverContextMargin", "hoverPopoverScale"];
var _a;
var DEFAULT_SETTINGS = {
  enabledOnThisDevice: false,
  exportFormatName: "Smart Import",
  zoteroHost: "127.0.0.1",
  zoteroPort: 23119,
  libraryId: 1,
  pollIntervalSeconds: 45,
  quietCooldownSeconds: 90,
  allowedItemTypes: ["journalArticle"],
  stubTriggerTags: ["\u{1F4DA}\uFE0F", "\u{1F4D6}", "\u2705", "\u{1F534}", "\u{1F7E1}", "\u{1F535}"],
  sourceFolder: "2 - Source Material",
  citekeyProperty: "citekey",
  lastLibraryVersion: 0,
  resolveCitekeyLinks: false,
  zoteroDataDir: `${(_a = process.env.HOME) != null ? _a : "~"}/Zotero`,
  hoverPreviews: true,
  hoverRequiresModKey: false,
  hoverMaxScale: 2,
  hoverMinScale: 0.55,
  hoverFill: 0.95,
  hoverDebug: false,
  hoverPopoverWidth: 620,
  hoverPopoverHeight: 420,
  highlightInsertTemplate: DEFAULT_INSERT_TEMPLATE,
  highlightFallbackTemplate: DEFAULT_FALLBACK_TEMPLATE
};

// src/zotero.ts
var http = __toESM(require("http"));
var DEFAULT_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "obsidian/zotero-mirror",
  Accept: "application/json"
};
var ZoteroClient = class {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.prefix = "/api/users/0";
    /** Per-poll item cache so resolving many annotations of one paper is cheap. */
    this.cache = /* @__PURE__ */ new Map();
  }
  resetCache() {
    this.cache.clear();
  }
  get(pathOrUrl) {
    return new Promise((resolve, reject) => {
      let host = this.host;
      let port = this.port;
      let path2 = pathOrUrl;
      if (/^https?:\/\//i.test(pathOrUrl)) {
        const u = new URL(pathOrUrl);
        host = u.hostname;
        port = parseInt(u.port || "80", 10);
        path2 = u.pathname + u.search;
      }
      const req = http.request(
        { host, port, path: path2, method: "GET", headers: DEFAULT_HEADERS },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (d) => body += d);
          res.on("end", () => {
            var _a2;
            let json;
            try {
              json = body ? JSON.parse(body) : void 0;
            } catch (e) {
              json = void 0;
            }
            resolve({ status: (_a2 = res.statusCode) != null ? _a2 : 0, headers: res.headers, json });
          });
        }
      );
      req.on("error", reject);
      req.setTimeout(8e3, () => req.destroy(new Error("Zotero request timed out")));
      req.end();
    });
  }
  header(res, name) {
    const v = res.headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  }
  nextLink(res) {
    const link = this.header(res, "Link");
    if (!link)
      return null;
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    return m ? m[1] : null;
  }
  async isReachable() {
    try {
      const res = await this.get(`${this.prefix}/items?limit=1`);
      return res.status === 200;
    } catch (e) {
      return false;
    }
  }
  /** Current top library version (used to baseline on first install). */
  async getCurrentVersion() {
    var _a2;
    const res = await this.get(`${this.prefix}/items?limit=1`);
    return parseInt((_a2 = this.header(res, "Last-Modified-Version")) != null ? _a2 : "0", 10) || 0;
  }
  /** All items changed since `version`, with full `data`, following pagination. */
  async getChangedSince(version) {
    var _a2, _b, _c;
    let url = `${this.prefix}/items?since=${version}&limit=100&include=data`;
    const items = [];
    let newVersion = version;
    let first = true;
    while (url) {
      const res = await this.get(url);
      if (res.status !== 200)
        break;
      if (first) {
        newVersion = parseInt((_a2 = this.header(res, "Last-Modified-Version")) != null ? _a2 : "0", 10) || version;
        first = false;
      }
      const page = (_b = res.json) != null ? _b : [];
      for (const entry of page) {
        if (entry == null ? void 0 : entry.data) {
          this.cache.set(entry.data.key, entry.data);
          items.push(entry.data);
        }
      }
      url = (_c = this.nextLink(res)) != null ? _c : "";
    }
    return { items, newVersion };
  }
  /** Fetch a single item's `data` (cached within the current poll). */
  async getItemData(key) {
    var _a2, _b;
    const cached = this.cache.get(key);
    if (cached)
      return cached;
    const res = await this.get(`${this.prefix}/items/${key}?include=data`);
    if (res.status !== 200)
      return null;
    const data = (_b = (_a2 = res.json) == null ? void 0 : _a2.data) != null ? _b : null;
    if (data)
      this.cache.set(key, data);
    return data;
  }
  /**
   * Walk an item up to its top-level parent.
   *   annotation -> attachment (parentItem) -> top-level (parentItem)
   *   attachment -> top-level (parentItem)
   *   anything else is already top-level.
   */
  async resolveTopLevel(data) {
    let current = data;
    let hops = 0;
    while ((current == null ? void 0 : current.parentItem) && hops < 4) {
      current = await this.getItemData(current.parentItem);
      hops++;
    }
    return current;
  }
  /**
   * Every annotation item in the library, with `data`.
   *
   * Used to build the geometry cache for highlight links. Annotation bodies are
   * NOT read from here (the Zotero Integration plugin extracts those from the
   * PDF itself); only position, colour and parentage, which the API is reliable
   * for. A few hundred milliseconds over localhost for a library this size.
   */
  async getAllAnnotations() {
    var _a2, _b;
    let url = `${this.prefix}/items?itemType=annotation&limit=100&include=data`;
    const items = [];
    while (url) {
      const res = await this.get(url);
      if (res.status !== 200)
        break;
      const page = (_a2 = res.json) != null ? _a2 : [];
      for (const entry of page)
        if (entry == null ? void 0 : entry.data)
          items.push(entry.data);
      url = (_b = this.nextLink(res)) != null ? _b : "";
    }
    return items;
  }
  /**
   * Top-level items carrying any of `tags` — the backfill set.
   * Uses the API's `tag=a || b` OR syntax. Optionally restrict by item type;
   * by default returns all types (caller filters by citationKey presence).
   */
  async getTaggedItems(tags, itemType) {
    var _a2, _b;
    const tagExpr = encodeURIComponent(tags.join(" || "));
    const typeParam = itemType ? `itemType=${encodeURIComponent(itemType)}&` : "";
    let url = `${this.prefix}/items?${typeParam}tag=${tagExpr}&limit=100&include=data`;
    const items = [];
    while (url) {
      const res = await this.get(url);
      if (res.status !== 200)
        break;
      const page = (_a2 = res.json) != null ? _a2 : [];
      for (const entry of page)
        if (entry == null ? void 0 : entry.data)
          items.push(entry.data);
      url = (_b = this.nextLink(res)) != null ? _b : "";
    }
    return items;
  }
};

// src/main.ts
var INTEGRATION_PLUGIN_ID = "obsidian-zotero-desktop-connector";
var ZoteroMirrorPlugin = class extends import_obsidian7.Plugin {
  constructor() {
    super(...arguments);
    /** citekey -> last time we saw activity (ms). Drained once quiet. */
    this.pending = /* @__PURE__ */ new Map();
    this.pollHandle = 0;
    this.polling = false;
    /** citekeys we've already warned about missing-citationKey, to avoid log spam. */
    this.warnedNoCitekey = /* @__PURE__ */ new Set();
    this.lastStatus = "idle";
  }
  async onload() {
    await this.loadSettings();
    this.client = new ZoteroClient(this.settings.zoteroHost, this.settings.zoteroPort);
    this.tracked = new TrackedIndex(this.app, this.settings);
    this.positions = new PositionIndex(this.client, this);
    this.hover = new HighlightHover(this.app, this.settings, this.positions);
    this.highlights = new HighlightIndex(this.app, this.settings, this.tracked);
    this.inserter = new HighlightReferenceInserter(
      this.app,
      this.settings,
      this.highlights,
      this.positions
    );
    this.linkResolver = new CitekeyLinkResolver(this.app, this.settings, this.tracked);
    this.addSettingTab(new ZoteroMirrorSettingTab(this.app, this));
    this.hover.registerEvents(this);
    void this.positions.loadCache();
    this.addCommand({
      id: "insert-highlight-reference",
      name: "Insert highlight reference",
      callback: () => void this.inserter.run()
    });
    this.app.workspace.onLayoutReady(async () => {
      this.tracked.rebuild();
      this.tracked.registerEvents(this);
      this.highlights.registerEvents(this);
      this.linkResolver.registerEvents(this);
      await this.ensureBaseline();
      this.restartPolling();
      void this.tick();
      void this.positions.ensure();
    });
  }
  onunload() {
    if (this.pollHandle)
      window.clearInterval(this.pollHandle);
    releaseDocuments();
  }
  // ---- settings plumbing -------------------------------------------------
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (migrateSettings(this.settings))
      await this.saveSettings();
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  /** Re-create the API client after host/port changes. */
  applyConnectionSettings() {
    this.client = new ZoteroClient(this.settings.zoteroHost, this.settings.zoteroPort);
    this.positions = new PositionIndex(this.client, this);
    void this.positions.loadCache();
    this.inserter = new HighlightReferenceInserter(
      this.app,
      this.settings,
      this.highlights,
      this.positions
    );
    this.hover.setPositions(this.positions);
  }
  restartPolling() {
    if (this.pollHandle)
      window.clearInterval(this.pollHandle);
    const ms = Math.max(5, this.settings.pollIntervalSeconds) * 1e3;
    this.pollHandle = window.setInterval(() => void this.tick(), ms);
    this.registerInterval(this.pollHandle);
  }
  // ---- the loop ----------------------------------------------------------
  /** On first ever run, baseline to the current version so the historical
   *  annotation backlog is ignored. Also self-heals if baseline never ran. */
  async ensureBaseline() {
    if (this.settings.lastLibraryVersion > 0)
      return true;
    if (!await this.client.isReachable())
      return false;
    this.settings.lastLibraryVersion = await this.client.getCurrentVersion();
    await this.saveSettings();
    return true;
  }
  async tick() {
    if (!this.settings.enabledOnThisDevice)
      return;
    try {
      await this.poll();
      await this.flushQuiet();
    } catch (e) {
      console.error("[zotero-mirror] tick failed", e);
      this.lastStatus = `error: ${e.message}`;
    }
  }
  async poll() {
    if (this.polling)
      return;
    this.polling = true;
    try {
      if (!await this.client.isReachable()) {
        this.lastStatus = "Zotero not reachable";
        return;
      }
      if (this.settings.lastLibraryVersion === 0) {
        await this.ensureBaseline();
        return;
      }
      this.client.resetCache();
      const { items, newVersion } = await this.client.getChangedSince(
        this.settings.lastLibraryVersion
      );
      for (const item of items) {
        await this.consider(item);
      }
      if (newVersion > this.settings.lastLibraryVersion) {
        this.settings.lastLibraryVersion = newVersion;
        await this.saveSettings();
      }
      this.lastStatus = `ok @ v${this.settings.lastLibraryVersion}, ${this.pending.size} pending`;
    } finally {
      this.polling = false;
    }
  }
  /** Decide whether a changed item should (eventually) trigger an import. */
  async consider(item) {
    var _a2;
    this.positions.absorb(item);
    const top = await this.client.resolveTopLevel(item);
    if (!top)
      return;
    const citekey = (_a2 = top.citationKey) == null ? void 0 : _a2.replace(/^@/, "").trim();
    if (!citekey) {
      if (!this.warnedNoCitekey.has(top.key)) {
        this.warnedNoCitekey.add(top.key);
        console.warn(`[zotero-mirror] no citationKey for item ${top.key}; skipping`);
      }
      return;
    }
    const isAnnotation = item.itemType === "annotation";
    const typeAllowed = this.settings.allowedItemTypes.includes(top.itemType);
    if (this.tracked.has(citekey)) {
      this.enqueue(citekey);
    } else if (isAnnotation && typeAllowed) {
      this.enqueue(citekey);
    } else if (this.hasTriggerTag(top.tags)) {
      this.enqueue(citekey);
    }
  }
  hasTriggerTag(tags) {
    if (!(tags == null ? void 0 : tags.length))
      return false;
    return tags.some((t) => this.settings.stubTriggerTags.includes(t.tag));
  }
  enqueue(citekey) {
    this.pending.set(citekey, Date.now());
  }
  /** Import every pending paper that has been quiet for the cooldown. */
  async flushQuiet() {
    const now = Date.now();
    const cooldownMs = this.settings.quietCooldownSeconds * 1e3;
    for (const [citekey, lastSeen] of [...this.pending]) {
      if (now - lastSeen >= cooldownMs) {
        this.pending.delete(citekey);
        await this.importOne(citekey);
      }
    }
  }
  // ---- importing ---------------------------------------------------------
  getIntegration() {
    var _a2, _b;
    const p = (_b = (_a2 = this.app.plugins) == null ? void 0 : _a2.plugins) == null ? void 0 : _b[INTEGRATION_PLUGIN_ID];
    return p && typeof p.runImport === "function" ? p : null;
  }
  async importOne(citekey) {
    const zi = this.getIntegration();
    if (!zi) {
      new import_obsidian7.Notice('Zotero Mirror: "Zotero Integration" plugin not found / no runImport.');
      return false;
    }
    try {
      await zi.runImport(this.settings.exportFormatName, citekey, this.settings.libraryId);
      return true;
    } catch (e) {
      console.error(`[zotero-mirror] import failed for ${citekey}`, e);
      new import_obsidian7.Notice(`Zotero Mirror: import failed for ${citekey} (see console).`);
      return false;
    }
  }
  // ---- actions used by the settings tab ----------------------------------
  /** Force one poll + flush now (manual button / verification). */
  async forceSync() {
    this.client.resetCache();
    await this.poll();
    await this.flushQuiet();
  }
  /** Re-baseline to the current library version (forget the backlog). */
  async resetBaseline() {
    if (!await this.client.isReachable()) {
      new import_obsidian7.Notice("Zotero Mirror: Zotero not reachable.");
      return;
    }
    this.settings.lastLibraryVersion = await this.client.getCurrentVersion();
    await this.saveSettings();
    new import_obsidian7.Notice(`Zotero Mirror: baseline reset to v${this.settings.lastLibraryVersion}.`);
  }
  /** Tagged items of ANY type (matching the tag path) that do NOT yet have a note. */
  async collectBackfill() {
    var _a2, _b;
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const items = await this.client.getTaggedItems(this.settings.stubTriggerTags);
    for (const it of items) {
      const citekey = (_a2 = it.citationKey) == null ? void 0 : _a2.replace(/^@/, "").trim();
      if (!citekey || seen.has(citekey))
        continue;
      seen.add(citekey);
      if (this.tracked.has(citekey))
        continue;
      out.push({ citekey, title: (_b = it.title) != null ? _b : citekey });
    }
    return out;
  }
  /**
   * Every tracked paper, for re-importing in place.
   *
   * Needed because block anchors were added to the template after most notes
   * were already imported: those notes have no `^annotationKey` to reference
   * until they are rendered again.
   */
  collectTracked() {
    return this.tracked.citekeys().map((citekey) => {
      var _a2, _b;
      return {
        citekey,
        title: (_b = (_a2 = this.tracked.fileFor(citekey)) == null ? void 0 : _a2.basename) != null ? _b : citekey
      };
    });
  }
  /** Import a list throttled to avoid a LiveSync revision storm. */
  async runBackfill(list, onProgress) {
    let done = 0;
    for (const c of list) {
      const ok = await this.importOne(c.citekey);
      if (ok)
        done++;
      onProgress == null ? void 0 : onProgress(done, list.length);
      await sleep(400);
    }
    return done;
  }
};
function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
