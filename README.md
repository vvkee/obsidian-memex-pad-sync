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

**主页**：启动自动打开的 dashboard——问候语+时钟、笔记/inbox/同步统计、快捷入口（新建长文 / 今日 digest / 立即同步）、最近笔记。

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
