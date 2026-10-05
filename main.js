"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => MemexPadSyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/sha1.ts
function sha1Hex(data) {
  const ml = data.length;
  const paddedLen = (ml + 8 >> 6) + 1 << 6;
  const buf = new Uint8Array(paddedLen);
  buf.set(data);
  buf[ml] = 128;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen - 8, Math.floor(ml * 8 / 4294967296));
  view.setUint32(paddedLen - 4, ml * 8 >>> 0);
  let h0 = 1732584193;
  let h1 = 4023233417;
  let h2 = 2562383102;
  let h3 = 271733878;
  let h4 = 3285377520;
  const w = new Uint32Array(80);
  const rol = (x, n) => (x << n | x >>> 32 - n) >>> 0;
  for (let off = 0; off < paddedLen; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(off + t * 4);
    for (let t = 16; t < 80; t++) w[t] = rol(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      let f, k;
      if (t < 20) {
        f = b & c | ~b & d;
        k = 1518500249;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 1859775393;
      } else if (t < 60) {
        f = b & c | b & d | c & d;
        k = 2400959708;
      } else {
        f = b ^ c ^ d;
        k = 3395469782;
      }
      const tmp = rol(a, 5) + f + e + k + w[t] >>> 0;
      e = d;
      d = c;
      c = rol(b, 30);
      b = a;
      a = tmp;
    }
    h0 = h0 + a >>> 0;
    h1 = h1 + b >>> 0;
    h2 = h2 + c >>> 0;
    h3 = h3 + d >>> 0;
    h4 = h4 + e >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, "0")).join("");
}
function gitBlobSha(data) {
  const head = new TextEncoder().encode(`blob ${data.length}\0`);
  const full = new Uint8Array(head.length + data.length);
  full.set(head, 0);
  full.set(data, head.length);
  return sha1Hex(full);
}

// src/main.ts
var VIEW_TYPE_HOME = "memex-pad-home";
var PUSH_DEBOUNCE_MS = 6e4;
var DEFAULT_SETTINGS = {
  owner: "vvkee",
  repo: "memex",
  branch: "main",
  token: "",
  syncOnStartup: true,
  twoWay: false,
  openHomeOnStartup: true
};
var DEFAULT_STATE = { headSha: null, treeSha: null, files: {}, lastSyncAt: null };
function fmtDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtDateTime(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${fmtDate(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function relTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1e3);
  if (s < 60) return "\u521A\u521A";
  if (s < 3600) return `${Math.floor(s / 60)} \u5206\u949F\u524D`;
  if (s < 86400) return `${Math.floor(s / 3600)} \u5C0F\u65F6\u524D`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}
function isManaged(path) {
  return !path.startsWith(".obsidian/");
}
function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 32768)));
  }
  return btoa(s);
}
function toArrayBuffer(u8) {
  if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) {
    return u8.buffer;
  }
  const c = u8.slice();
  return c.buffer;
}
var NewNoteModal = class extends import_obsidian.Modal {
  constructor(app, plugin, templates) {
    var _a, _b;
    super(app);
    this.titleText = "";
    this.plugin = plugin;
    this.templates = templates;
    this.templatePath = (_b = (_a = templates[0]) == null ? void 0 : _a.path) != null ? _b : "";
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "\u65B0\u5EFA\u957F\u6587" });
    new import_obsidian.Setting(contentEl).setName("\u6807\u9898").addText(
      (t) => t.setPlaceholder("\u8FD9\u7BC7\u957F\u6587\u53EB\u4EC0\u4E48").onChange((v) => this.titleText = v)
    );
    const tplSetting = new import_obsidian.Setting(contentEl).setName("\u6A21\u677F");
    const sel = tplSetting.controlEl.createEl("select");
    for (const f of this.templates) {
      const opt = sel.createEl("option", { text: f.basename });
      opt.value = f.path;
    }
    sel.value = this.templatePath;
    sel.onchange = () => this.templatePath = sel.value;
    new import_obsidian.Setting(contentEl).addButton(
      (b) => b.setButtonText("\u521B\u5EFA").setCta().onClick(() => void this.create())
    );
  }
  onClose() {
    this.contentEl.empty();
  }
  async create() {
    const title = this.titleText.trim().replace(/[/\\?%*:|"<>]/g, "").slice(0, 80) || "\u672A\u547D\u540D";
    try {
      const tplFile = this.app.vault.getAbstractFileByPath(this.templatePath);
      if (!(tplFile instanceof import_obsidian.TFile)) throw new Error("\u6A21\u677F\u6587\u4EF6\u4E0D\u5B58\u5728");
      const tpl = await this.app.vault.read(tplFile);
      const date = fmtDate(/* @__PURE__ */ new Date());
      const body = tpl.split("{{title}}").join(title).split("{{date}}").join(date);
      let path = `notes/${date}-${title}.md`;
      let i = 2;
      while (await this.app.vault.adapter.exists(path)) {
        path = `notes/${date}-${title}-${i}.md`;
        i++;
      }
      await this.app.vault.create(path, body);
      const created = this.app.vault.getAbstractFileByPath(path);
      this.close();
      if (created instanceof import_obsidian.TFile) {
        await this.app.workspace.getLeaf(true).openFile(created);
      }
      new import_obsidian.Notice(`\u5DF2\u521B\u5EFA ${path}`);
      this.plugin.schedulePush();
    } catch (e) {
      new import_obsidian.Notice(`\u521B\u5EFA\u5931\u8D25\uFF1A${e instanceof Error ? e.message : e}`);
    }
  }
};
var HomeView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.clockTimer = null;
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_HOME;
  }
  getDisplayText() {
    return "Memex \u4E3B\u9875";
  }
  getIcon() {
    return "home";
  }
  async onOpen() {
    this.render();
    this.clockTimer = window.setInterval(() => {
      const el = this.containerEl.querySelector(".memex-clock");
      if (el) el.textContent = this.clockText();
    }, 1e3);
  }
  async onClose() {
    if (this.clockTimer !== null) window.clearInterval(this.clockTimer);
  }
  refresh() {
    if (this.containerEl.isConnected) this.render();
  }
  greeting() {
    const h = (/* @__PURE__ */ new Date()).getHours();
    if (h < 6) return "\u51CC\u6668\u597D";
    if (h < 9) return "\u65E9\u4E0A\u597D";
    if (h < 12) return "\u4E0A\u5348\u597D";
    if (h < 14) return "\u4E2D\u5348\u597D";
    if (h < 18) return "\u4E0B\u5348\u597D";
    return "\u665A\u4E0A\u597D";
  }
  clockText() {
    const d = /* @__PURE__ */ new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  dateText() {
    const d = /* @__PURE__ */ new Date();
    const week = ["\u65E5", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D"][d.getDay()];
    return `${fmtDate(d)} \xB7 \u661F\u671F${week}`;
  }
  render() {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("memex-home");
    const style = root.createEl("style");
    style.textContent = `
.memex-home { padding: 28px 32px; max-width: 860px; margin: 0 auto; }
.memex-hero { margin-bottom: 20px; }
.memex-hello { font-size: 26px; font-weight: 700; margin: 0 0 4px; }
.memex-date { color: var(--text-muted); font-size: 13px; display:flex; gap:12px; align-items:baseline;}
.memex-clock { font-size: 30px; font-weight: 700; font-variant-numeric: tabular-nums; margin-left: auto;}
.memex-stats { display: flex; gap: 10px; margin: 18px 0; }
.memex-stat { flex: 1; background: var(--background-secondary); border-radius: 10px; padding: 12px 14px; }
.memex-stat .n { font-size: 22px; font-weight: 700; }
.memex-stat .l { font-size: 12px; color: var(--text-muted); }
.memex-sec { font-size: 13px; font-weight: 700; color: var(--text-muted); margin: 20px 0 10px; }
.memex-actions { display: flex; gap: 10px; }
.memex-btn { flex: 1; border: 1px solid var(--background-modifier-border); background: var(--background-secondary);
  border-radius: 12px; padding: 16px 8px; text-align: center; cursor: pointer; font-size: 14px; }
.memex-btn:hover { background: var(--background-modifier-hover); }
.memex-btn .e { font-size: 22px; display: block; margin-bottom: 6px; }
.memex-row { display: flex; align-items: baseline; gap: 10px; padding: 9px 4px;
  border-bottom: 1px solid var(--background-modifier-border); cursor: pointer; }
.memex-row:hover .t { color: var(--text-accent); }
.memex-row .t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.memex-row .m { font-size: 12px; color: var(--text-faint); white-space: nowrap; }
.memex-empty { color: var(--text-faint); font-size: 13px; padding: 8px 4px; }
`;
    const hero = root.createDiv("memex-hero");
    hero.createEl("h1", { text: `${this.greeting()}\uFF0C\u4ECA\u5929\u4E5F\u5199\u4E00\u70B9\u5427`, cls: "memex-hello" });
    const dateRow = hero.createDiv("memex-date");
    dateRow.createSpan({ text: this.dateText() });
    dateRow.createSpan({ text: this.clockText(), cls: "memex-clock" });
    const files = this.app.vault.getMarkdownFiles();
    const notesCount = files.filter((f) => f.path.startsWith("notes/")).length;
    const inboxCount = files.filter((f) => /^inbox\/[^/]+\.md$/.test(f.path)).length;
    const lastSync = this.plugin.data.state.lastSyncAt;
    const stats = root.createDiv("memex-stats");
    const mkStat = (n, l) => {
      const s = stats.createDiv("memex-stat");
      s.createDiv({ text: n, cls: "n" });
      s.createDiv({ text: l, cls: "l" });
    };
    mkStat(String(notesCount), "\u7B14\u8BB0");
    mkStat(String(inboxCount), "inbox \u5F85\u5904\u7406");
    mkStat(lastSync ? relTime(lastSync) : "\u2014", "\u4E0A\u6B21\u540C\u6B65");
    root.createDiv({ text: "\u5FEB\u6377\u5165\u53E3", cls: "memex-sec" });
    const actions = root.createDiv("memex-actions");
    const mkBtn = (emoji, label, fn) => {
      const b = actions.createDiv("memex-btn");
      b.createSpan({ text: emoji, cls: "e" });
      b.createSpan({ text: label });
      b.onclick = fn;
    };
    mkBtn("\u270F\uFE0F", "\u65B0\u5EFA\u957F\u6587", () => this.plugin.newNoteFlow());
    mkBtn("\u{1F4D6}", "\u4ECA\u65E5 digest", () => void this.plugin.openTodayDigest());
    mkBtn("\u21BB", "\u7ACB\u5373\u540C\u6B65", () => void this.plugin.fullSync(true));
    root.createDiv({ text: "\u6700\u8FD1\u7B14\u8BB0", cls: "memex-sec" });
    const recent = files.filter((f) => !f.path.startsWith("templates/")).sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 8);
    if (recent.length === 0) {
      root.createDiv({ text: "\u8FD8\u6CA1\u6709\u7B14\u8BB0", cls: "memex-empty" });
    }
    for (const f of recent) {
      const row = root.createDiv("memex-row");
      row.createSpan({ text: f.basename, cls: "t" });
      row.createSpan({ text: relTime(f.stat.mtime), cls: "m" });
      row.onclick = () => void this.app.workspace.getLeaf(true).openFile(f);
    }
  }
};
var MemexPadSyncPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.syncing = false;
    this.selfWriting = false;
    this.pushTimer = null;
  }
  async onload() {
    await this.loadPluginData();
    this.registerView(VIEW_TYPE_HOME, (leaf) => new HomeView(leaf, this));
    this.addRibbonIcon("home", "Memex \u4E3B\u9875", () => void this.openHome());
    this.addRibbonIcon("file-plus", "\u65B0\u5EFA\u957F\u6587", () => this.newNoteFlow());
    this.addRibbonIcon("refresh-cw", "\u7ACB\u5373\u540C\u6B65", () => void this.fullSync(true));
    this.addCommand({ id: "open-home", name: "\u6253\u5F00\u4E3B\u9875", callback: () => void this.openHome() });
    this.addCommand({ id: "new-note", name: "\u65B0\u5EFA\u957F\u6587", callback: () => this.newNoteFlow() });
    this.addCommand({ id: "sync-now", name: "\u7ACB\u5373\u540C\u6B65", callback: () => void this.fullSync(true) });
    this.addSettingTab(new MemexPadSyncSettingTab(this.app, this));
    for (const ev of ["create", "modify", "delete", "rename"]) {
      this.registerEvent(this.app.vault.on(ev, () => this.onLocalChange()));
    }
    this.app.workspace.onLayoutReady(() => {
      if (this.data.settings.openHomeOnStartup) void this.openHome();
      if (this.data.settings.syncOnStartup) {
        if (!this.data.settings.token) {
          new import_obsidian.Notice("Memex Pad Sync\uFF1A\u8BF7\u5148\u5728\u8BBE\u7F6E\u91CC\u586B\u5199 GitHub Token");
          return;
        }
        void this.pullSync(false);
      }
    });
  }
  onunload() {
    if (this.pushTimer !== null) window.clearTimeout(this.pushTimer);
  }
  async loadPluginData() {
    var _a, _b;
    const raw = await super.loadData();
    this.data = {
      settings: { ...DEFAULT_SETTINGS, ...(_a = raw == null ? void 0 : raw.settings) != null ? _a : {} },
      state: { ...DEFAULT_STATE, ...(_b = raw == null ? void 0 : raw.state) != null ? _b : {} }
    };
  }
  async save() {
    await this.saveData(this.data);
  }
  // ---------- GitHub API ----------
  async gh(path, method = "GET", body) {
    const s = this.data.settings;
    const res = await (0, import_obsidian.requestUrl)({
      url: `https://api.github.com${path}`,
      method,
      headers: {
        Authorization: `Bearer ${s.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...body !== void 0 ? { "Content-Type": "application/json" } : {}
      },
      body: body !== void 0 ? JSON.stringify(body) : void 0,
      throw: false
    });
    if (res.status === 401) throw new Error("Token \u65E0\u6548\uFF08401\uFF09");
    if (res.status === 403) {
      const msg = JSON.stringify(res.json).slice(0, 200);
      if (/rate limit/i.test(msg)) throw new Error("GitHub API \u9650\u6D41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5");
      throw new Error("\u6CA1\u6709\u6743\u9650\uFF08403\uFF09\uFF1A\u68C0\u67E5 Token \u662F\u5426\u6388\u6743\u4E86\u672C\u4ED3\u5E93 Contents \u8BFB\u5199");
    }
    if (res.status === 404) throw new Error("\u4ED3\u5E93\u6216\u5206\u652F\u4E0D\u5B58\u5728\uFF08404\uFF09");
    if (res.status === 422) throw new Error(`\u8BF7\u6C42\u88AB\u62D2\u7EDD\uFF08422\uFF09\uFF1A${JSON.stringify(res.json).slice(0, 160)}`);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`GitHub API \u9519\u8BEF ${res.status}`);
    }
    return res.json;
  }
  repoBase() {
    const s = this.data.settings;
    return `/repos/${s.owner}/${s.repo}`;
  }
  // ---------- 文件写入 ----------
  async ensureDir(dir) {
    if (!dir) return;
    const parts = dir.split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      try {
        await this.app.vault.adapter.mkdir(cur);
      } catch (e) {
      }
    }
  }
  async writeFileRaw(path, bytes) {
    const dir = path.split("/").slice(0, -1).join("/");
    await this.ensureDir(dir);
    await this.app.vault.adapter.writeBinary(path, toArrayBuffer(bytes));
  }
  // ---------- 下行同步（pull）----------
  async pullSync(manual) {
    const s = this.data.settings;
    if (!s.token) {
      if (manual) new import_obsidian.Notice("\u8BF7\u5148\u5728\u8BBE\u7F6E\u91CC\u586B\u5199 GitHub Token");
      return;
    }
    if (this.syncing) {
      if (manual) new import_obsidian.Notice("\u6B63\u5728\u540C\u6B65\u4E2D\u2026");
      return;
    }
    this.syncing = true;
    try {
      if (manual) new import_obsidian.Notice("\u6B63\u5728\u540C\u6B65\u2026");
      const head = await this.gh(`${this.repoBase()}/commits/${encodeURIComponent(s.branch)}`);
      if (head.sha === this.data.state.headSha) {
        this.data.state.lastSyncAt = Date.now();
        await this.save();
        if (manual) new import_obsidian.Notice("\u5DF2\u662F\u6700\u65B0");
        this.refreshHome();
        return;
      }
      const tree = await this.gh(
        `${this.repoBase()}/git/trees/${head.sha}?recursive=1`
      );
      const entries = tree.tree.filter((e) => e.type === "blob" && e.path && e.sha && isManaged(e.path));
      const nextFiles = {};
      let changed = 0;
      this.selfWriting = true;
      try {
        for (const e of entries) {
          const path = e.path;
          nextFiles[path] = e.sha;
          if (this.data.state.files[path] === e.sha) continue;
          const blob = await this.gh(
            `${this.repoBase()}/git/blobs/${e.sha}`
          );
          if (!blob.content) continue;
          const bin = Uint8Array.from(atob(blob.content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
          await this.writeFileRaw(path, bin);
          changed++;
        }
        for (const path of Object.keys(this.data.state.files)) {
          if (!(path in nextFiles)) {
            try {
              await this.app.vault.adapter.remove(path);
              changed++;
            } catch (e) {
            }
          }
        }
      } finally {
        this.selfWriting = false;
      }
      this.data.state = { headSha: head.sha, treeSha: tree.sha, files: nextFiles, lastSyncAt: Date.now() };
      await this.save();
      new import_obsidian.Notice(manual || changed > 0 ? `\u540C\u6B65\u5B8C\u6210\uFF1A${changed} \u4E2A\u6587\u4EF6\u66F4\u65B0` : "\u540C\u6B65\u5B8C\u6210");
      this.refreshHome();
    } catch (e) {
      console.error(e);
      new import_obsidian.Notice(`\u540C\u6B65\u5931\u8D25\uFF1A${e instanceof Error ? e.message : e}`);
    } finally {
      this.syncing = false;
    }
  }
  // ---------- 上行同步（push）----------
  onLocalChange() {
    this.schedulePush();
  }
  schedulePush() {
    if (!this.data.settings.twoWay || this.selfWriting) return;
    if (this.pushTimer !== null) window.clearTimeout(this.pushTimer);
    this.pushTimer = window.setTimeout(() => {
      this.pushTimer = null;
      void this.pushSync(false);
    }, PUSH_DEBOUNCE_MS);
  }
  async collectChanges() {
    const files = this.app.vault.getFiles().filter((f) => isManaged(f.path));
    const data = {};
    const created = [];
    const modified = [];
    const seen = /* @__PURE__ */ new Set();
    for (const f of files) {
      const bytes = new Uint8Array(await this.app.vault.adapter.readBinary(f.path));
      data[f.path] = bytes;
      seen.add(f.path);
      const sha = gitBlobSha(bytes);
      const old = this.data.state.files[f.path];
      if (!old) created.push(f.path);
      else if (old !== sha) modified.push(f.path);
    }
    const deleted = Object.keys(this.data.state.files).filter((p) => !seen.has(p));
    return { created, modified, deleted, data };
  }
  async pushSync(manual) {
    const s = this.data.settings;
    if (!s.twoWay) return;
    if (!s.token) {
      if (manual) new import_obsidian.Notice("\u8BF7\u5148\u5728\u8BBE\u7F6E\u91CC\u586B\u5199 GitHub Token");
      return;
    }
    if (this.syncing) {
      if (manual) new import_obsidian.Notice("\u6B63\u5728\u540C\u6B65\u4E2D\u2026");
      return;
    }
    this.syncing = true;
    try {
      await this.pullSync(false);
      const { created, modified, deleted, data } = await this.collectChanges();
      const total = created.length + modified.length + deleted.length;
      if (total === 0) {
        if (manual) new import_obsidian.Notice("\u5DF2\u662F\u6700\u65B0");
        return;
      }
      if (manual) new import_obsidian.Notice(`\u6B63\u5728\u63A8\u9001 ${total} \u4E2A\u53D8\u66F4\u2026`);
      const blobShas = {};
      for (const p of [...created, ...modified]) {
        const r = await this.gh(`${this.repoBase()}/git/blobs`, "POST", {
          content: bytesToB64(data[p]),
          encoding: "base64"
        });
        blobShas[p] = r.sha;
      }
      const head = await this.gh(`${this.repoBase()}/commits/${encodeURIComponent(s.branch)}`);
      if (head.sha !== this.data.state.headSha) {
        throw new Error("\u8FDC\u7AEF\u6709\u65B0\u63D0\u4EA4\uFF0C\u8BF7\u91CD\u65B0\u540C\u6B65\u540E\u518D\u63A8\u9001");
      }
      const entries = [
        ...Object.keys(blobShas).map((p) => ({
          path: p,
          mode: "100644",
          type: "blob",
          sha: blobShas[p]
        })),
        ...deleted.map((p) => ({ path: p, mode: "100644", type: "blob", sha: null }))
      ];
      const tree = await this.gh(`${this.repoBase()}/git/trees`, "POST", {
        base_tree: this.data.state.treeSha,
        tree: entries
      });
      const commit = await this.gh(`${this.repoBase()}/git/commits`, "POST", {
        message: `ipad: \u540C\u6B65 ${fmtDateTime(/* @__PURE__ */ new Date())}`,
        tree: tree.sha,
        parents: [head.sha]
      });
      await this.gh(`${this.repoBase()}/git/refs/heads/${encodeURIComponent(s.branch)}`, "PATCH", {
        sha: commit.sha
      });
      const nextFiles = { ...this.data.state.files };
      for (const p of [...created, ...modified]) nextFiles[p] = gitBlobSha(data[p]);
      for (const p of deleted) delete nextFiles[p];
      this.data.state = { headSha: commit.sha, treeSha: tree.sha, files: nextFiles, lastSyncAt: Date.now() };
      await this.save();
      new import_obsidian.Notice(`\u5DF2\u63A8\u9001\u5230 git\uFF1A${total} \u4E2A\u53D8\u66F4`);
      this.refreshHome();
    } catch (e) {
      console.error(e);
      new import_obsidian.Notice(`\u63A8\u9001\u5931\u8D25\uFF1A${e instanceof Error ? e.message : e}`);
    } finally {
      this.syncing = false;
    }
  }
  /** 手动同步 = 下行 +（开了双向才）上行 */
  async fullSync(manual) {
    await this.pullSync(manual);
    if (this.data.settings.twoWay) await this.pushSync(false);
  }
  // ---------- 主页 / 长文 ----------
  async openHome() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HOME);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_HOME, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  refreshHome() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOME)) {
      const v = leaf.view;
      if (v instanceof HomeView) v.refresh();
    }
  }
  newNoteFlow() {
    const templates = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("templates/")).sort((a, b) => a.basename.localeCompare(b.basename));
    if (templates.length === 0) {
      new import_obsidian.Notice("templates/ \u91CC\u6CA1\u6709\u6A21\u677F\uFF1A\u5148\u540C\u6B65\u4E00\u6B21\u628A\u4ED3\u5E93\u6A21\u677F\u62C9\u4E0B\u6765");
      return;
    }
    new NewNoteModal(this.app, this, templates).open();
  }
  async openTodayDigest() {
    const path = `digest/${fmtDate(/* @__PURE__ */ new Date())}.md`;
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof import_obsidian.TFile) {
      await this.app.workspace.getLeaf(true).openFile(f);
    } else {
      new import_obsidian.Notice("\u4ECA\u65E5 digest \u8FD8\u6CA1\u751F\u6210\uFF08\u6BCF\u5929 8:00\uFF09");
    }
  }
};
var MemexPadSyncSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.data.settings;
    containerEl.createEl("p", {
      text: "\u628A GitHub \u4E0A\u7684 memex \u4ED3\u5E93\u955C\u50CF\u5230\u672C vault\u3002iPhone \u4E0A\u5EFA\u8BAE\u5173\u95ED\u53CC\u5411\u540C\u6B65\uFF0C\u53EA\u5F53\u53EA\u8BFB\u955C\u50CF\uFF1BiPad \u4E0A\u6253\u5F00\uFF0C\u5373\u662F\u5199\u4F5C\u673A\u3002"
    });
    new import_obsidian.Setting(containerEl).setName("\u53CC\u5411\u540C\u6B65\uFF08iPad \u5199\u4F5C\uFF09").setDesc("\u6253\u5F00\u540E\uFF1A\u672C\u5730\u65B0\u5EFA/\u4FEE\u6539/\u5220\u9664\u6587\u4EF6\u4F1A\u5728 60 \u79D2\u540E\u81EA\u52A8 push \u5230 git\u3002\u5173\u95ED = \u53EA\u8BFB\u955C\u50CF\u3002").addToggle(
      (t) => t.setValue(s.twoWay).onChange(async (v) => {
        s.twoWay = v;
        await this.plugin["save"]();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u542F\u52A8\u65F6\u6253\u5F00\u4E3B\u9875").addToggle(
      (t) => t.setValue(s.openHomeOnStartup).onChange(async (v) => {
        s.openHomeOnStartup = v;
        await this.plugin["save"]();
      })
    );
    new import_obsidian.Setting(containerEl).setName("owner").addText(
      (t) => t.setValue(s.owner).onChange(async (v) => {
        s.owner = v.trim();
        await this.plugin["save"]();
      })
    );
    new import_obsidian.Setting(containerEl).setName("repo").addText(
      (t) => t.setValue(s.repo).onChange(async (v) => {
        s.repo = v.trim();
        await this.plugin["save"]();
      })
    );
    new import_obsidian.Setting(containerEl).setName("branch").addText(
      (t) => t.setValue(s.branch).onChange(async (v) => {
        s.branch = v.trim() || "main";
        await this.plugin["save"]();
      })
    );
    new import_obsidian.Setting(containerEl).setName("GitHub Token").setDesc("fine-grained PAT\uFF1A\u53EA\u6388\u6743\u672C\u4ED3\u5E93\uFF0CContents \u8BFB\uFF08\u53EA\u8BFB\u955C\u50CF\uFF09/ \u8BFB\u5199\uFF08\u53CC\u5411\u540C\u6B65\uFF09\u3002").addText((t) => {
      t.inputEl.type = "password";
      t.setValue(s.token).onChange(async (v) => {
        s.token = v.trim();
        await this.plugin["save"]();
      });
    });
    new import_obsidian.Setting(containerEl).setName("\u542F\u52A8\u65F6\u81EA\u52A8\u540C\u6B65").addToggle(
      (t) => t.setValue(s.syncOnStartup).onChange(async (v) => {
        s.syncOnStartup = v;
        await this.plugin["save"]();
      })
    );
  }
};
