# Memex Sync

Obsidian 社区插件：把一个 GitHub 仓库**只读镜像**到当前 vault。写给 iOS 离线阅读用的——因为：

- Working Copy 的"链接仓库到目录"是 Pro 付费功能
- obsidian-git 在 iOS 上被作者自己标为 very unstable（isomorphic-git 内存问题）
- iOS 的文件 App 会隐藏 `.obsidian`，手动安装插件此路不通

## 原理

不实现 git，只走 GitHub API：

1. 取分支 HEAD 的 commit sha，没变就直接返回（1 次请求）
2. 变了就拉递归 tree，对比本地 manifest，只下载 sha 变化了的文件（`git/blobs` API）
3. 远端删除的文件本地跟删（只删插件自己同步过的；你在本地新建的文件不会动）
4. 永远跳过 `.obsidian/`

手机端只读：不提供 push。所有写入由别处（Mac 上的 agent）通过 git 完成。

## 安装

1. Obsidian → 设置 → 第三方插件 → 浏览 → 搜 **BRAT** → 安装并启用
2. 设置 → BRAT → Add beta plugin → 填 `vvkee/obsidian-memex-sync`
3. 回到第三方插件列表，启用 Memex Sync
4. 插件设置里填 owner / repo / branch / GitHub Token（私有仓库需要；去 GitHub 建 fine-grained Token，只给目标仓库 `Contents: Read` 权限）
5. 点"立即同步"；打开"启动时同步"（iOS 后台受限，打开 App 时同步是最可靠的触发时机）

## 开发

```bash
npm install
npm run build   # 输出 main.js
```

之后通过 BRAT 的"Check for updates" 更新，或等进官方插件市场。
