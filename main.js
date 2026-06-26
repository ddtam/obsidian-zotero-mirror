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
var import_obsidian3 = require("obsidian");

// src/settings.ts
var import_obsidian = require("obsidian");
var ZoteroMirrorSettingTab = class extends import_obsidian.PluginSettingTab {
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
    new import_obsidian.Setting(containerEl).setName("Activation").setHeading();
    new import_obsidian.Setting(containerEl).setName("Enable on this device").setDesc(
      "Only ONE device should have this on. If multiple LiveSync devices poll and import the same paper, they will write conflicting copies of the note."
    ).addToggle(
      (t) => t.setValue(s.enabledOnThisDevice).onChange(async (v) => {
        s.enabledOnThisDevice = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Import format").setDesc("Name of the Zotero Integration export format to drive (must exist there).").addText(
      (t) => t.setPlaceholder("Smart Import").setValue(s.exportFormatName).onChange(async (v) => {
        s.exportFormatName = v.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Timing").setHeading();
    new import_obsidian.Setting(containerEl).setName("Poll interval (seconds)").setDesc("How often to check Zotero for changes.").addText(
      (t) => t.setValue(String(s.pollIntervalSeconds)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n >= 5) {
          s.pollIntervalSeconds = n;
          await this.plugin.saveSettings();
          this.plugin.restartPolling();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Quiet cooldown (seconds)").setDesc(
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
    new import_obsidian.Setting(containerEl).setName("Scope").setHeading();
    new import_obsidian.Setting(containerEl).setName("Item types for new notes").setDesc(
      "Comma-separated Zotero item types eligible for NEW note creation. Already-imported notes update regardless of type."
    ).addText(
      (t) => t.setValue(s.allowedItemTypes.join(", ")).onChange(async (v) => {
        s.allowedItemTypes = this.parseList(v);
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Stub trigger tags").setDesc(
      "Comma-separated Zotero tags that make a journal article a discoverable stub (status / priority emojis). Reuses your existing triage tags."
    ).addText(
      (t) => t.setValue(s.stubTriggerTags.join(", ")).onChange(async (v) => {
        s.stubTriggerTags = this.parseList(v);
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Source folder").setDesc('Vault folder whose notes\u2019 citekeys mark a paper as "tracked".').addText(
      (t) => t.setValue(s.sourceFolder).onChange(async (v) => {
        s.sourceFolder = v.trim();
        await this.plugin.saveSettings();
        this.plugin.tracked.rebuild();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Citekey property").setDesc("Frontmatter property holding the Better BibTeX citekey.").addText(
      (t) => t.setValue(s.citekeyProperty).onChange(async (v) => {
        s.citekeyProperty = v.trim() || "citekey";
        await this.plugin.saveSettings();
        this.plugin.tracked.rebuild();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Zotero connection").setHeading();
    new import_obsidian.Setting(containerEl).setName("Host").addText(
      (t) => t.setValue(s.zoteroHost).onChange(async (v) => {
        s.zoteroHost = v.trim() || "127.0.0.1";
        await this.plugin.saveSettings();
        this.plugin.applyConnectionSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Port").addText(
      (t) => t.setValue(String(s.zoteroPort)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n)) {
          s.zoteroPort = n;
          await this.plugin.saveSettings();
          this.plugin.applyConnectionSettings();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Library id").setDesc('BBT library id passed to runImport (1 = personal "My Library").').addText(
      (t) => t.setValue(String(s.libraryId)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n)) {
          s.libraryId = n;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Actions").setHeading();
    new import_obsidian.Setting(containerEl).setName("Sync now").setDesc("Run one poll + import cycle immediately.").addButton(
      (b) => b.setButtonText("Sync now").onClick(async () => {
        if (!s.enabledOnThisDevice) {
          new import_obsidian.Notice("Enable on this device first.");
          return;
        }
        new import_obsidian.Notice("Zotero Mirror: syncing\u2026");
        await this.plugin.forceSync();
        new import_obsidian.Notice(`Zotero Mirror: ${this.plugin.lastStatus}`);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Backfill reading pile").setDesc(
      "One-time: import tagged journal articles that have no note yet (throttled)."
    ).addButton(
      (b) => b.setButtonText("Backfill\u2026").onClick(async () => {
        new import_obsidian.Notice("Zotero Mirror: collecting candidates\u2026");
        let list;
        try {
          list = await this.plugin.collectBackfill();
        } catch (e) {
          new import_obsidian.Notice("Zotero Mirror: failed to query Zotero (see console).");
          console.error(e);
          return;
        }
        if (list.length === 0) {
          new import_obsidian.Notice("Zotero Mirror: nothing to backfill.");
          return;
        }
        new ConfirmModal(
          this.app,
          `Import ${list.length} tagged paper(s) with no note yet?`,
          "They will be imported one at a time (~2.5/sec) on this device.",
          async () => {
            const notice = new import_obsidian.Notice(`Backfill: 0/${list.length}`, 0);
            const done = await this.plugin.runBackfill(list, (d, total) => {
              notice.setMessage(`Backfill: ${d}/${total}`);
            });
            notice.hide();
            new import_obsidian.Notice(`Zotero Mirror: backfilled ${done}/${list.length}.`);
          }
        ).open();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Reset baseline").setDesc(
      "Forget the backlog: set the tracking point to Zotero\u2019s current version. Future changes only."
    ).addButton(
      (b) => b.setWarning().setButtonText("Reset baseline").onClick(async () => {
        await this.plugin.resetBaseline();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Status").setHeading();
    containerEl.createEl("p", {
      text: `Tracked notes: ${this.plugin.tracked.size()} \xB7 Library version: ${s.lastLibraryVersion} \xB7 Last: ${this.plugin.lastStatus}`,
      cls: "setting-item-description"
    });
  }
};
var ConfirmModal = class extends import_obsidian.Modal {
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
    new import_obsidian.Setting(contentEl).addButton(
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
var import_obsidian2 = require("obsidian");
var TrackedIndex = class {
  constructor(app, settings) {
    this.app = app;
    this.settings = settings;
    this.citekeys = /* @__PURE__ */ new Set();
  }
  has(citekey) {
    return this.citekeys.has(citekey);
  }
  size() {
    return this.citekeys.size;
  }
  inScope(file) {
    return file instanceof import_obsidian2.TFile && file.extension === "md" && (file.path === this.settings.sourceFolder || file.path.startsWith(this.settings.sourceFolder + "/"));
  }
  citekeyOf(cache) {
    var _a;
    const raw = (_a = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _a[this.settings.citekeyProperty];
    if (raw === void 0 || raw === null)
      return null;
    const key = String(raw).trim();
    return key ? key.replace(/^@/, "") : null;
  }
  /** Full rebuild from the metadata cache. */
  rebuild() {
    this.citekeys.clear();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.inScope(file))
        continue;
      const key = this.citekeyOf(this.app.metadataCache.getFileCache(file));
      if (key)
        this.citekeys.add(key);
    }
  }
  /** Keep the index current as notes are written, deleted, or moved. */
  registerEvents(plugin) {
    plugin.registerEvent(
      this.app.metadataCache.on("changed", (file, _data, cache) => {
        if (!this.inScope(file))
          return;
        const key = this.citekeyOf(cache);
        if (key)
          this.citekeys.add(key);
      })
    );
    plugin.registerEvent(this.app.vault.on("delete", () => this.rebuild()));
    plugin.registerEvent(this.app.vault.on("rename", () => this.rebuild()));
  }
};

// src/types.ts
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
  lastLibraryVersion: 0
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
      let path = pathOrUrl;
      if (/^https?:\/\//i.test(pathOrUrl)) {
        const u = new URL(pathOrUrl);
        host = u.hostname;
        port = parseInt(u.port || "80", 10);
        path = u.pathname + u.search;
      }
      const req = http.request(
        { host, port, path, method: "GET", headers: DEFAULT_HEADERS },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (d) => body += d);
          res.on("end", () => {
            var _a;
            let json;
            try {
              json = body ? JSON.parse(body) : void 0;
            } catch (e) {
              json = void 0;
            }
            resolve({ status: (_a = res.statusCode) != null ? _a : 0, headers: res.headers, json });
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
    var _a;
    const res = await this.get(`${this.prefix}/items?limit=1`);
    return parseInt((_a = this.header(res, "Last-Modified-Version")) != null ? _a : "0", 10) || 0;
  }
  /** All items changed since `version`, with full `data`, following pagination. */
  async getChangedSince(version) {
    var _a, _b, _c;
    let url = `${this.prefix}/items?since=${version}&limit=100&include=data`;
    const items = [];
    let newVersion = version;
    let first = true;
    while (url) {
      const res = await this.get(url);
      if (res.status !== 200)
        break;
      if (first) {
        newVersion = parseInt((_a = this.header(res, "Last-Modified-Version")) != null ? _a : "0", 10) || version;
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
    var _a, _b;
    const cached = this.cache.get(key);
    if (cached)
      return cached;
    const res = await this.get(`${this.prefix}/items/${key}?include=data`);
    if (res.status !== 200)
      return null;
    const data = (_b = (_a = res.json) == null ? void 0 : _a.data) != null ? _b : null;
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
   * Top-level journal articles carrying any of `tags` — the backfill set.
   * Uses the API's `tag=a || b` OR syntax.
   */
  async getTaggedItems(itemType, tags) {
    var _a, _b;
    const tagExpr = encodeURIComponent(tags.join(" || "));
    let url = `${this.prefix}/items?itemType=${itemType}&tag=${tagExpr}&limit=100&include=data`;
    const items = [];
    while (url) {
      const res = await this.get(url);
      if (res.status !== 200)
        break;
      const page = (_a = res.json) != null ? _a : [];
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
var ZoteroMirrorPlugin = class extends import_obsidian3.Plugin {
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
    this.addSettingTab(new ZoteroMirrorSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(async () => {
      this.tracked.rebuild();
      this.tracked.registerEvents(this);
      await this.ensureBaseline();
      this.restartPolling();
      void this.tick();
    });
  }
  onunload() {
    if (this.pollHandle)
      window.clearInterval(this.pollHandle);
  }
  // ---- settings plumbing -------------------------------------------------
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  /** Re-create the API client after host/port changes. */
  applyConnectionSettings() {
    this.client = new ZoteroClient(this.settings.zoteroHost, this.settings.zoteroPort);
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
    var _a;
    const top = await this.client.resolveTopLevel(item);
    if (!top)
      return;
    const citekey = (_a = top.citationKey) == null ? void 0 : _a.replace(/^@/, "").trim();
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
    } else if (typeAllowed && this.hasTriggerTag(top.tags)) {
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
    var _a, _b;
    const p = (_b = (_a = this.app.plugins) == null ? void 0 : _a.plugins) == null ? void 0 : _b[INTEGRATION_PLUGIN_ID];
    return p && typeof p.runImport === "function" ? p : null;
  }
  async importOne(citekey) {
    const zi = this.getIntegration();
    if (!zi) {
      new import_obsidian3.Notice('Zotero Mirror: "Zotero Integration" plugin not found / no runImport.');
      return false;
    }
    try {
      await zi.runImport(this.settings.exportFormatName, citekey, this.settings.libraryId);
      return true;
    } catch (e) {
      console.error(`[zotero-mirror] import failed for ${citekey}`, e);
      new import_obsidian3.Notice(`Zotero Mirror: import failed for ${citekey} (see console).`);
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
      new import_obsidian3.Notice("Zotero Mirror: Zotero not reachable.");
      return;
    }
    this.settings.lastLibraryVersion = await this.client.getCurrentVersion();
    await this.saveSettings();
    new import_obsidian3.Notice(`Zotero Mirror: baseline reset to v${this.settings.lastLibraryVersion}.`);
  }
  /** Tagged, in-scope journal articles that do NOT yet have a note. */
  async collectBackfill() {
    var _a, _b;
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const type of this.settings.allowedItemTypes) {
      const items = await this.client.getTaggedItems(type, this.settings.stubTriggerTags);
      for (const it of items) {
        const citekey = (_a = it.citationKey) == null ? void 0 : _a.replace(/^@/, "").trim();
        if (!citekey || seen.has(citekey))
          continue;
        seen.add(citekey);
        if (this.tracked.has(citekey))
          continue;
        out.push({ citekey, title: (_b = it.title) != null ? _b : citekey });
      }
    }
    return out;
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
