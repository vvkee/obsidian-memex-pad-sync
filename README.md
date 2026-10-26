# Memex Pad Sync

Obsidian 社区插件：memex vault 的 GitHub **双向同步** + 主页 dashboard + 模板建文。

定位：
- **iPad**：打开"双向同步"，即是写作机——主页快捷入口 → 模板弹窗新建长文 → 保存 60 秒后自动 push 到 git
- **iPhone**：关闭"双向同步"，即是只读镜像——离线阅读用

为什么自研而不是用现有方案：

- Working Copy 的"链接仓库到目录"是 Pro 付费功能
- obsidian-git 在 iOS 上被作者自己标为 very unstable（isomorphic-git 内存问题）
- iOS 的文件 App 会隐藏 `.obsidian`，手动安装插件此路不通

## 原理

不实现 git，只走 GitHub API：

**下行（pull）**：取分支 HEAD 的 commit sha，没变就直接返回（1 次请求）；变了就拉递归 tree，对比本地 manifest，只下载 sha 变化了的文件；远端删除的文件本地跟删（只删插件自己同步过的）；永远跳过 `.obsidian/`。

**上行（push）**：本地文件有新建/修改/删除时，60 秒防抖后自动 push。流程：先 pull（保证 base 最新）→ 本地算 git blob sha 找差异 → 建 blob → 以远端 tree 为 base 建新 tree（含删除）→ 建 commit → 更新分支 ref。push 前二次确认远端 HEAD 没动；非 fast-forward 直接报错，**永不强推**。

**自动轮询（v2.1.0）**：Obsidian 长开时不再只依赖启动同步和手动同步——前台运行时默认每 60 秒检查一次 main 的 HEAD sha，不变直接返回（1 次请求，不下载文件），变了才拉 tree 增量更新；切回前台、打开主页时也会立即拉一次。iOS 切后台会挂起定时器，回前台时补拉。设置里可关轮询，或把间隔改成 30 秒 / 3 分钟 / 5 分钟。轮询复用现有 pull 逻辑和 `syncing` 互斥，不会和推送打架。

**CSS snippets 白名单（v2.2.0）**：原来永跳整个 `.obsidian/`，现在只放行 `.obsidian/snippets/` 下的 `.css` 文件，字体、阅读样式这类 snippet 可以随 vault 同步到四端。其他一律不放行：`.obsidian/plugins/`（尤其本插件自己的 `data.json`，里面有 GitHub Token，绝不能进仓库）、`workspace.json` / `workspace-mobile.json`（各端窗口布局）、主题文件等。注意两点：① snippet 文件到了各端后，还要在该端设置 → 外观 → CSS snippets 里手动打开一次，Obsidian 不会自动启用新到的 snippet；② snippet 只应来自你自己的私有 vault 仓库，CSS 能 @import 外部资源，不要从不可信的仓库同步 snippet。旧版升级到 v2.2.0 后，首次拉取会强制重新比对 tree（只下载新增的 snippet，已有文件跳过），否则 head 没变会直接返回“已是最新”，snippet 永远到不了。

**误删除修复（v2.2.1，必升）**：`vault.getFiles()` 看不到 `.obsidian/` 和点文件，旧版推送把“看不到”当成“已删除”。2026-10-25 iPad 一次双向推送误删了远端的 snippet、`.gitignore`、`.claude/settings.json`、多个 `.gitkeep`。v2.2.1 起，推送前对 state 里有、getFiles 里没有的文件先用 `adapter.exists` 核对，还在就按现存比对，真没了才删，核对出错时宁可不删。**在 iPad / Windows / Mac 上更新到 2.2.1 之前，不要从双向端做推送（手动同步也会先拉后推），否则还会误删。**

**主页 v2（v2.3.0）**：启动自动打开的 dashboard——问候语+日期（大时钟已去掉）、可行动的统计（进行中数、待确认数、inbox 待处理数，另附待办清单入口和上次同步时间）、目标胶囊（交易学习 / 摄影 / 旅行 / memex，点进对应主题索引）、进行中、待确认、最近笔记（只取 `notes/`，不再混 digest 和 `_agent/` 文件）。进行中一节不是阅读进度追踪（插件不记阅读位置），只是把 `status: 进行中` 的正文笔记排前面，供继续推进；frontmatter 从 Obsidian 的 metadataCache 读，缺 frontmatter 的文件不进进行中/待确认。

**主页待办列表（v2.4.0）**：主页新增“待办”一节，直接解析 `notes/待办清单.md`，按今日 / 即将到来 / 随时 / 某天分区渲染，任务下面跟备注小字，随时里按电脑 / GR IV / a7CR / NAS 分组，已完成只计不列。列表是只读的：点任务打开待办清单原文，勾选请到原文里勾，否则待办清单和原文的复选框会两边不一致。

**主页待办矩阵（v2.5.0，设计稿先行）**：待办一节改成真正的 2×2 四象限矩阵，横轴紧急 → 不紧急，纵轴重要 → 不重要；格子之间只有 1px 分隔线，没有卡片和底色块；象限 icon + 复选框边框同色（🔥 红 / 🎯 青 / ⚡ 黄 / 🌿 灰），任务前有区域 icon（📸 / 📈 / ✈️）；窄屏下 2 列自动变 1 列。vault 的待办文件同步改成四象限结构，时间只做行内 meta，两边同源，不会只改一边对不上。列表仍是只读的。

**模板建文**：ribbon「新建长文」→ 弹窗选 `templates/` 里的模板（模板存在仓库里，多端共用）→ 输入标题 → 在 `notes/` 建好带 frontmatter 的文件并打开。

## 安装

1. Obsidian → 设置 → 第三方插件 → 浏览 → 搜 **BRAT** → 安装并启用
2. 设置 → BRAT → Add beta plugin → 填 `vvkee/obsidian-memex-pad-sync`
3. 回到第三方插件列表，启用 Memex Pad Sync
4. 插件设置里填 owner / repo / branch / GitHub Token（去 GitHub 建 fine-grained Token，只给目标仓库授权：只读镜像给 `Contents: Read`，双向同步给 `Contents: Read and write`）
5. iPad：打开"双向同步"；iPhone：保持关闭
6. 点"立即同步"

## 开发

```bash
npm install
npm run build   # 输出 main.js
```

之后通过 BRAT 的"Check for updates" 更新，或等进官方插件市场。
