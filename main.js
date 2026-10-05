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
  default: () => MemexSyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  owner: "vvkee",
  repo: "memex",
  branch: "main",
  token: "",
  syncOnStartup: true
};
var DEFAULT_DATA = {
  settings: DEFAULT_SETTINGS,
  state: { headSha: null, lastSyncAt: null, files: {} }
};
function isManaged(path) {
  return !path.startsWith(".obsidian/");
}
function b64ToBytes(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
var MemexSyncPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.syncing = false;
  }
  async onload() {
    this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());
    this.data.settings = Object.assign({}, DEFAULT_SETTINGS, this.data.settings);
    this.data.state = Object.assign(
      { headSha: null, lastSyncAt: null, files: {} },
      this.data.state
    );
    this.addRibbonIcon("sync", "\u540C\u6B65 memex", () => this.sync(true));
    this.addCommand({
      id: "memex-sync-now",
      name: "\u7ACB\u5373\u540C\u6B65",
      callback: () => this.sync(true)
    });
    this.addSettingTab(new MemexSyncSettingTab(this.app, this));
    if (this.data.settings.syncOnStartup) {
      window.setTimeout(() => this.sync(false), 2500);
    }
  }
  async gh(path) {
    var _a, _b;
    const s = this.data.settings;
    let res;
    try {
      res = await (0, import_obsidian.requestUrl)({
        url: `https://api.github.com${path}`,
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "memex-sync-obsidian-plugin",
          Authorization: `Bearer ${s.token}`
        }
      });
    } catch (e) {
      throw new Error((_a = e == null ? void 0 : e.message) != null ? _a : "\u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25");
    }
    if (res.status === 401) {
      throw new Error("GitHub \u8BA4\u8BC1\u5931\u8D25\uFF1AToken \u65E0\u6548\u6216\u65E0\u6743\u8BBF\u95EE\u8BE5\u4ED3\u5E93");
    }
    if (res.status === 403) {
      const remaining = (_b = res.headers) == null ? void 0 : _b["x-ratelimit-remaining"];
      throw new Error(
        remaining === "0" ? "GitHub API \u9650\u6D41\u4E86\uFF0C\u7A0D\u540E\u518D\u8BD5" : "GitHub \u62D2\u7EDD\u8BBF\u95EE\uFF1AToken \u65E0\u6743\u8BBF\u95EE\u8BE5\u4ED3\u5E93"
      );
    }
    if (res.status === 404) {
      throw new Error("\u4ED3\u5E93\u6216\u5206\u652F\u4E0D\u5B58\u5728\uFF0C\u8BF7\u68C0\u67E5\u8BBE\u7F6E");
    }
    if (res.status >= 400) {
      throw new Error(`GitHub API \u9519\u8BEF\uFF08${res.status}\uFF09`);
    }
    return res.json;
  }
  /** Read-only mirror: remote wins, local-only files we created are kept. */
  async sync(manual) {
    var _a;
    const s = this.data.settings;
    if (!s.owner || !s.repo || !s.branch) {
      if (manual) new import_obsidian.Notice("\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u91CC\u586B\u5199\u4ED3\u5E93\u4FE1\u606F");
      return;
    }
    if (!s.token) {
      if (manual) new import_obsidian.Notice("\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u91CC\u586B\u5199 GitHub Token\uFF08\u79C1\u6709\u4ED3\u5E93\u9700\u8981\uFF09");
      return;
    }
    if (this.syncing) {
      if (manual) new import_obsidian.Notice("\u6B63\u5728\u540C\u6B65\u4E2D\uFF0C\u7A0D\u7B49\u2026");
      return;
    }
    this.syncing = true;
    try {
      if (manual) new import_obsidian.Notice("\u6B63\u5728\u540C\u6B65 memex\u2026");
      const commit = await this.gh(
        `/repos/${s.owner}/${s.repo}/commits/${encodeURIComponent(s.branch)}`
      );
      if (commit.sha === this.data.state.headSha) {
        if (manual) new import_obsidian.Notice("\u5DF2\u662F\u6700\u65B0\uFF0C\u65E0\u9700\u540C\u6B65");
        return;
      }
      const tree = await this.gh(`/repos/${s.owner}/${s.repo}/git/trees/${encodeURIComponent(s.branch)}?recursive=1`);
      if (tree.truncated) throw new Error("\u4ED3\u5E93\u6587\u4EF6\u592A\u591A\uFF0Ctree \u88AB\u622A\u65AD\uFF0C\u65E0\u6CD5\u5B89\u5168\u540C\u6B65");
      const blobs = tree.tree.filter((e) => e.type === "blob" && isManaged(e.path));
      const newFiles = {};
      let updated = 0;
      for (const b of blobs) {
        newFiles[b.path] = b.sha;
        if (this.data.state.files[b.path] === b.sha) continue;
        const blob = await this.gh(
          `/repos/${s.owner}/${s.repo}/git/blobs/${b.sha}`
        );
        if (blob.encoding !== "base64") throw new Error(`\u65E0\u6CD5\u89E3\u7801\u6587\u4EF6 ${b.path}`);
        await this.writeFile(b.path, b64ToBytes(blob.content));
        updated++;
      }
      let removed = 0;
      for (const p of Object.keys(this.data.state.files)) {
        if (!(p in newFiles)) {
          try {
            await this.app.vault.adapter.remove(p);
            removed++;
          } catch (e) {
          }
        }
      }
      this.data.state = {
        headSha: commit.sha,
        lastSyncAt: Date.now(),
        files: newFiles
      };
      await this.saveData(this.data);
      const msg = updated === 0 && removed === 0 ? "\u540C\u6B65\u5B8C\u6210\uFF1A\u5185\u5BB9\u65E0\u53D8\u5316" : `\u540C\u6B65\u5B8C\u6210\uFF1A${updated} \u4E2A\u6587\u4EF6\u66F4\u65B0${removed > 0 ? `\uFF0C${removed} \u4E2A\u6587\u4EF6\u5220\u9664` : ""}`;
      new import_obsidian.Notice(msg);
    } catch (e) {
      console.error("[memex-sync]", e);
      if (manual) new import_obsidian.Notice("\u540C\u6B65\u5931\u8D25\uFF1A" + ((_a = e == null ? void 0 : e.message) != null ? _a : "\u672A\u77E5\u9519\u8BEF"));
    } finally {
      this.syncing = false;
    }
  }
  async writeFile(path, data) {
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir) await this.ensureDir(dir);
    await this.app.vault.adapter.writeBinary(path, data.buffer);
  }
  async ensureDir(dir) {
    const parts = dir.split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!await this.app.vault.adapter.exists(cur)) {
        await this.app.vault.createFolder(cur);
      }
    }
  }
};
var MemexSyncSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    var _a;
    const { containerEl } = this;
    const s = this.plugin.data.settings;
    const st = this.plugin.data.state;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Memex Sync \u8BBE\u7F6E" });
    containerEl.createEl("p", {
      text: "\u628A GitHub \u4E0A\u7684 memex \u4ED3\u5E93\u53EA\u8BFB\u955C\u50CF\u5230\u5F53\u524D vault\uFF0C\u7528\u4E8E iOS \u79BB\u7EBF\u9605\u8BFB\u3002\u624B\u673A\u7AEF\u4E0D\u5199 vault\uFF0C\u6240\u6709\u5199\u5165\u90FD\u7531 Mac \u7AEF agent \u901A\u8FC7 git \u5B8C\u6210\u3002"
    });
    new import_obsidian.Setting(containerEl).setName("\u4ED3\u5E93 owner").addText(
      (t) => t.setValue(s.owner).onChange(async (v) => {
        s.owner = v.trim();
        await this.plugin.saveData(this.plugin.data);
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u4ED3\u5E93\u540D").addText(
      (t) => t.setValue(s.repo).onChange(async (v) => {
        s.repo = v.trim();
        await this.plugin.saveData(this.plugin.data);
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u5206\u652F").addText(
      (t) => t.setValue(s.branch).onChange(async (v) => {
        s.branch = v.trim() || "main";
        await this.plugin.saveData(this.plugin.data);
      })
    );
    new import_obsidian.Setting(containerEl).setName("GitHub Token").setDesc("\u79C1\u6709\u4ED3\u5E93\u9700\u8981\u3002\u53BB GitHub \u5EFA\u4E00\u4E2A fine-grained Token\uFF0C\u53EA\u7ED9\u8FD9\u4E2A\u4ED3\u5E93 Contents: Read \u6743\u9650\u5373\u53EF\u3002").addText((t) => {
      t.inputEl.type = "password";
      t.setValue(s.token).onChange(async (v) => {
        s.token = v.trim();
        this.plugin.data.state.headSha = null;
        await this.plugin.saveData(this.plugin.data);
      });
    });
    new import_obsidian.Setting(containerEl).setName("\u542F\u52A8\u65F6\u540C\u6B65").setDesc("\u6BCF\u6B21\u6253\u5F00 Obsidian \u81EA\u52A8\u540C\u6B65\uFF08iOS \u540E\u53F0\u53D7\u9650\uFF0C\u8FD9\u662F\u6700\u53EF\u9760\u7684\u89E6\u53D1\u65F6\u673A\uFF09\u3002").addToggle(
      (t) => t.setValue(s.syncOnStartup).onChange(async (v) => {
        s.syncOnStartup = v;
        await this.plugin.saveData(this.plugin.data);
      })
    );
    new import_obsidian.Setting(containerEl).addButton(
      (b) => b.setButtonText("\u7ACB\u5373\u540C\u6B65").setCta().onClick(() => this.plugin.sync(true))
    );
    const status = containerEl.createEl("p", { cls: "setting-item-description" });
    if (st.lastSyncAt) {
      const d = new Date(st.lastSyncAt);
      status.setText(
        `\u4E0A\u6B21\u540C\u6B65\uFF1A${d.toLocaleString()}\uFF0Ccommit ${(_a = st.headSha) == null ? void 0 : _a.slice(0, 7)}\uFF0C${Object.keys(st.files).length} \u4E2A\u6587\u4EF6`
      );
    } else {
      status.setText("\u5C1A\u672A\u540C\u6B65\u8FC7\u3002");
    }
  }
};
