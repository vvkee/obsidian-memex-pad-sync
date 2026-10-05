import {
	ItemView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
	requestUrl,
} from 'obsidian';
import { gitBlobSha } from './sha1';

const VIEW_TYPE_HOME = 'memex-pad-home';
const PUSH_DEBOUNCE_MS = 60_000;

interface MemexSyncSettings {
	owner: string;
	repo: string;
	branch: string;
	token: string;
	syncOnStartup: boolean;
	twoWay: boolean; // iPad 写作机：本地修改自动 push；iPhone 保持关闭 = 只读镜像
	openHomeOnStartup: boolean;
}

interface SyncState {
	headSha: string | null;
	treeSha: string | null;
	files: Record<string, string>; // path -> git blob sha
	lastSyncAt: number | null;
}

interface PluginData {
	settings: MemexSyncSettings;
	state: SyncState;
}

const DEFAULT_SETTINGS: MemexSyncSettings = {
	owner: 'vvkee',
	repo: 'memex',
	branch: 'main',
	token: '',
	syncOnStartup: true,
	twoWay: false,
	openHomeOnStartup: true,
};

const DEFAULT_STATE: SyncState = { headSha: null, treeSha: null, files: {}, lastSyncAt: null };

// ---------- helpers ----------

function fmtDate(d: Date): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtDateTime(d: Date): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${fmtDate(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function relTime(ts: number): string {
	const s = Math.floor((Date.now() - ts) / 1000);
	if (s < 60) return '刚刚';
	if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
	if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
	const d = new Date(ts);
	return `${d.getMonth() + 1}-${d.getDate()}`;
}

function isManaged(path: string): boolean {
	return !path.startsWith('.obsidian/');
}

function bytesToB64(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
	}
	return btoa(s);
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
	if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) {
		return u8.buffer as ArrayBuffer;
	}
	const c = u8.slice();
	return c.buffer as ArrayBuffer;
}

// ---------- 新建长文弹窗 ----------

class NewNoteModal extends Modal {
	private plugin: MemexPadSyncPlugin;
	private templates: TFile[];
	private titleText = '';
	private templatePath: string;

	constructor(app: import('obsidian').App, plugin: MemexPadSyncPlugin, templates: TFile[]) {
		super(app);
		this.plugin = plugin;
		this.templates = templates;
		this.templatePath = templates[0]?.path ?? '';
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: '新建长文' });

		new Setting(contentEl).setName('标题').addText((t) =>
			t.setPlaceholder('这篇长文叫什么').onChange((v) => (this.titleText = v)),
		);

		const tplSetting = new Setting(contentEl).setName('模板');
		const sel = tplSetting.controlEl.createEl('select');
		for (const f of this.templates) {
			const opt = sel.createEl('option', { text: f.basename });
			opt.value = f.path;
		}
		sel.value = this.templatePath;
		sel.onchange = () => (this.templatePath = sel.value);

		new Setting(contentEl).addButton((b) =>
			b.setButtonText('创建').setCta().onClick(() => void this.create()),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async create(): Promise<void> {
		const title = this.titleText.trim().replace(/[/\\?%*:|"<>]/g, '').slice(0, 80) || '未命名';
		try {
			const tplFile = this.app.vault.getAbstractFileByPath(this.templatePath);
			if (!(tplFile instanceof TFile)) throw new Error('模板文件不存在');
			const tpl = await this.app.vault.read(tplFile);
			const date = fmtDate(new Date());
			const body = tpl.split('{{title}}').join(title).split('{{date}}').join(date);
			let path = `notes/${date}-${title}.md`;
			let i = 2;
			while (await this.app.vault.adapter.exists(path)) {
				path = `notes/${date}-${title}-${i}.md`;
				i++;
			}
			await this.app.vault.create(path, body);
			const created = this.app.vault.getAbstractFileByPath(path);
			this.close();
			if (created instanceof TFile) {
				await this.app.workspace.getLeaf(true).openFile(created);
			}
			new Notice(`已创建 ${path}`);
			this.plugin.schedulePush();
		} catch (e) {
			new Notice(`创建失败：${e instanceof Error ? e.message : e}`);
		}
	}
}

// ---------- 主页视图 ----------

class HomeView extends ItemView {
	private plugin: MemexPadSyncPlugin;
	private clockTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: MemexPadSyncPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_HOME;
	}

	getDisplayText(): string {
		return 'Memex 主页';
	}

	getIcon(): string {
		return 'home';
	}

	async onOpen(): Promise<void> {
		this.render();
		this.clockTimer = window.setInterval(() => {
			const el = this.containerEl.querySelector('.memex-clock');
			if (el) el.textContent = this.clockText();
		}, 1000);
	}

	async onClose(): Promise<void> {
		if (this.clockTimer !== null) window.clearInterval(this.clockTimer);
	}

	refresh(): void {
		if (this.containerEl.isConnected) this.render();
	}

	private greeting(): string {
		const h = new Date().getHours();
		if (h < 6) return '凌晨好';
		if (h < 9) return '早上好';
		if (h < 12) return '上午好';
		if (h < 14) return '中午好';
		if (h < 18) return '下午好';
		return '晚上好';
	}

	private clockText(): string {
		const d = new Date();
		const p = (n: number) => String(n).padStart(2, '0');
		return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
	}

	private dateText(): string {
		const d = new Date();
		const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
		return `${fmtDate(d)} · 星期${week}`;
	}

	render(): void {
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.addClass('memex-home');

		const style = root.createEl('style');
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

		const hero = root.createDiv('memex-hero');
		hero.createEl('h1', { text: `${this.greeting()}，今天也写一点吧`, cls: 'memex-hello' });
		const dateRow = hero.createDiv('memex-date');
		dateRow.createSpan({ text: this.dateText() });
		dateRow.createSpan({ text: this.clockText(), cls: 'memex-clock' });

		const files = this.app.vault.getMarkdownFiles();
		const notesCount = files.filter((f) => f.path.startsWith('notes/')).length;
		const inboxCount = files.filter((f) => /^inbox\/[^/]+\.md$/.test(f.path)).length;
		const lastSync = this.plugin.data.state.lastSyncAt;

		const stats = root.createDiv('memex-stats');
		const mkStat = (n: string, l: string) => {
			const s = stats.createDiv('memex-stat');
			s.createDiv({ text: n, cls: 'n' });
			s.createDiv({ text: l, cls: 'l' });
		};
		mkStat(String(notesCount), '笔记');
		mkStat(String(inboxCount), 'inbox 待处理');
		mkStat(lastSync ? relTime(lastSync) : '—', '上次同步');

		root.createDiv({ text: '快捷入口', cls: 'memex-sec' });
		const actions = root.createDiv('memex-actions');
		const mkBtn = (emoji: string, label: string, fn: () => void) => {
			const b = actions.createDiv('memex-btn');
			b.createSpan({ text: emoji, cls: 'e' });
			b.createSpan({ text: label });
			b.onclick = fn;
		};
		mkBtn('✏️', '新建长文', () => this.plugin.newNoteFlow());
		mkBtn('📖', '今日 digest', () => void this.plugin.openTodayDigest());
		mkBtn('↻', '立即同步', () => void this.plugin.fullSync(true));

		root.createDiv({ text: '最近笔记', cls: 'memex-sec' });
		const recent = files
			.filter((f) => !f.path.startsWith('templates/'))
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, 8);
		if (recent.length === 0) {
			root.createDiv({ text: '还没有笔记', cls: 'memex-empty' });
		}
		for (const f of recent) {
			const row = root.createDiv('memex-row');
			row.createSpan({ text: f.basename, cls: 't' });
			row.createSpan({ text: relTime(f.stat.mtime), cls: 'm' });
			row.onclick = () => void this.app.workspace.getLeaf(true).openFile(f);
		}
	}
}

// ---------- 主插件 ----------

export default class MemexPadSyncPlugin extends Plugin {
	data!: PluginData;
	private syncing = false;
	private selfWriting = false;
	private pushTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadPluginData();

		this.registerView(VIEW_TYPE_HOME, (leaf) => new HomeView(leaf, this));

		this.addRibbonIcon('home', 'Memex 主页', () => void this.openHome());
		this.addRibbonIcon('file-plus', '新建长文', () => this.newNoteFlow());
		this.addRibbonIcon('refresh-cw', '立即同步', () => void this.fullSync(true));

		this.addCommand({ id: 'open-home', name: '打开主页', callback: () => void this.openHome() });
		this.addCommand({ id: 'new-note', name: '新建长文', callback: () => this.newNoteFlow() });
		this.addCommand({ id: 'sync-now', name: '立即同步', callback: () => void this.fullSync(true) });

		this.addSettingTab(new MemexPadSyncSettingTab(this.app, this));

		for (const ev of ['create', 'modify', 'delete', 'rename'] as const) {
			this.registerEvent(this.app.vault.on(ev, () => this.onLocalChange()));
		}

		this.app.workspace.onLayoutReady(() => {
			if (this.data.settings.openHomeOnStartup) void this.openHome();
			if (this.data.settings.syncOnStartup) {
				if (!this.data.settings.token) {
					new Notice('Memex Pad Sync：请先在设置里填写 GitHub Token');
					return;
				}
				void this.pullSync(false);
			}
		});
	}

	onunload(): void {
		if (this.pushTimer !== null) window.clearTimeout(this.pushTimer);
	}

	private async loadPluginData(): Promise<void> {
		const raw = (await super.loadData()) as Partial<PluginData> | null;
		this.data = {
			settings: { ...DEFAULT_SETTINGS, ...(raw?.settings ?? {}) },
			state: { ...DEFAULT_STATE, ...(raw?.state ?? {}) },
		};
	}

	private async save(): Promise<void> {
		await this.saveData(this.data);
	}

	// ---------- GitHub API ----------

	private async gh<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
		const s = this.data.settings;
		const res = await requestUrl({
			url: `https://api.github.com${path}`,
			method,
			headers: {
				Authorization: `Bearer ${s.token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
			},
			body: body !== undefined ? JSON.stringify(body) : undefined,
			throw: false,
		});
		if (res.status === 401) throw new Error('Token 无效（401）');
		if (res.status === 403) {
			const msg = JSON.stringify(res.json).slice(0, 200);
			if (/rate limit/i.test(msg)) throw new Error('GitHub API 限流，请稍后再试');
			throw new Error('没有权限（403）：检查 Token 是否授权了本仓库 Contents 读写');
		}
		if (res.status === 404) throw new Error('仓库或分支不存在（404）');
		if (res.status === 422) throw new Error(`请求被拒绝（422）：${JSON.stringify(res.json).slice(0, 160)}`);
		if (res.status < 200 || res.status >= 300) {
			throw new Error(`GitHub API 错误 ${res.status}`);
		}
		return res.json as T;
	}

	private repoBase(): string {
		const s = this.data.settings;
		return `/repos/${s.owner}/${s.repo}`;
	}

	// ---------- 文件写入 ----------

	private async ensureDir(dir: string): Promise<void> {
		if (!dir) return;
		const parts = dir.split('/');
		let cur = '';
		for (const p of parts) {
			cur = cur ? `${cur}/${p}` : p;
			try {
				await this.app.vault.adapter.mkdir(cur);
			} catch {
				/* 已存在 */
			}
		}
	}

	private async writeFileRaw(path: string, bytes: Uint8Array): Promise<void> {
		const dir = path.split('/').slice(0, -1).join('/');
		await this.ensureDir(dir);
		await this.app.vault.adapter.writeBinary(path, toArrayBuffer(bytes));
	}

	// ---------- 下行同步（pull）----------

	async pullSync(manual: boolean): Promise<void> {
		const s = this.data.settings;
		if (!s.token) {
			if (manual) new Notice('请先在设置里填写 GitHub Token');
			return;
		}
		if (this.syncing) {
			if (manual) new Notice('正在同步中…');
			return;
		}
		this.syncing = true;
		try {
			if (manual) new Notice('正在同步…');
			const head = await this.gh<{ sha: string }>(`${this.repoBase()}/commits/${encodeURIComponent(s.branch)}`);
			if (head.sha === this.data.state.headSha) {
				this.data.state.lastSyncAt = Date.now();
				await this.save();
				if (manual) new Notice('已是最新');
				this.refreshHome();
				return;
			}
			const tree = await this.gh<{ sha: string; tree: { path?: string; type?: string; sha?: string }[] }>(
				`${this.repoBase()}/git/trees/${head.sha}?recursive=1`,
			);
			const entries = tree.tree.filter((e) => e.type === 'blob' && e.path && e.sha && isManaged(e.path));
			const nextFiles: Record<string, string> = {};
			let changed = 0;
			this.selfWriting = true;
			try {
				for (const e of entries) {
					const path = e.path as string;
					nextFiles[path] = e.sha as string;
					if (this.data.state.files[path] === e.sha) continue;
					const blob = await this.gh<{ content?: string; encoding?: string }>(
						`${this.repoBase()}/git/blobs/${e.sha}`,
					);
					if (!blob.content) continue;
					const bin = Uint8Array.from(atob(blob.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
					await this.writeFileRaw(path, bin);
					changed++;
				}
				for (const path of Object.keys(this.data.state.files)) {
					if (!(path in nextFiles)) {
						try {
							await this.app.vault.adapter.remove(path);
							changed++;
						} catch {
							/* 可能已被手动删除 */
						}
					}
				}
			} finally {
				this.selfWriting = false;
			}
			this.data.state = { headSha: head.sha, treeSha: tree.sha, files: nextFiles, lastSyncAt: Date.now() };
			await this.save();
			new Notice(manual || changed > 0 ? `同步完成：${changed} 个文件更新` : '同步完成');
			this.refreshHome();
		} catch (e) {
			console.error(e);
			new Notice(`同步失败：${e instanceof Error ? e.message : e}`);
		} finally {
			this.syncing = false;
		}
	}

	// ---------- 上行同步（push）----------

	private onLocalChange(): void {
		this.schedulePush();
	}

	schedulePush(): void {
		if (!this.data.settings.twoWay || this.selfWriting) return;
		if (this.pushTimer !== null) window.clearTimeout(this.pushTimer);
		this.pushTimer = window.setTimeout(() => {
			this.pushTimer = null;
			void this.pushSync(false);
		}, PUSH_DEBOUNCE_MS);
	}

	private async collectChanges(): Promise<{
		created: string[];
		modified: string[];
		deleted: string[];
		data: Record<string, Uint8Array>;
	}> {
		const files = this.app.vault.getFiles().filter((f) => isManaged(f.path));
		const data: Record<string, Uint8Array> = {};
		const created: string[] = [];
		const modified: string[] = [];
		const seen = new Set<string>();
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

	async pushSync(manual: boolean): Promise<void> {
		const s = this.data.settings;
		if (!s.twoWay) return;
		if (!s.token) {
			if (manual) new Notice('请先在设置里填写 GitHub Token');
			return;
		}
		if (this.syncing) {
			if (manual) new Notice('正在同步中…');
			return;
		}
		this.syncing = true;
		try {
			// 先 pull，保证 base 是最新的
			await this.pullSync(false);
			const { created, modified, deleted, data } = await this.collectChanges();
			const total = created.length + modified.length + deleted.length;
			if (total === 0) {
				if (manual) new Notice('已是最新');
				return;
			}
			if (manual) new Notice(`正在推送 ${total} 个变更…`);

			// 建 blob
			const blobShas: Record<string, string> = {};
			for (const p of [...created, ...modified]) {
				const r = await this.gh<{ sha: string }>(`${this.repoBase()}/git/blobs`, 'POST', {
					content: bytesToB64(data[p]),
					encoding: 'base64',
				});
				blobShas[p] = r.sha;
			}
			// 确认远端没动（pull 之后有人 push 了就停下，不强推）
			const head = await this.gh<{ sha: string }>(`${this.repoBase()}/commits/${encodeURIComponent(s.branch)}`);
			if (head.sha !== this.data.state.headSha) {
				throw new Error('远端有新提交，请重新同步后再推送');
			}
			// 建 tree（含删除）
			const entries: { path: string; mode: string; type: string; sha: string | null }[] = [
				...Object.keys(blobShas).map((p) => ({
					path: p,
					mode: '100644',
					type: 'blob',
					sha: blobShas[p] as string | null,
				})),
				...deleted.map((p) => ({ path: p, mode: '100644', type: 'blob', sha: null as string | null })),
			];
			const tree = await this.gh<{ sha: string }>(`${this.repoBase()}/git/trees`, 'POST', {
				base_tree: this.data.state.treeSha,
				tree: entries,
			});
			// 建 commit
			const commit = await this.gh<{ sha: string }>(`${this.repoBase()}/git/commits`, 'POST', {
				message: `ipad: 同步 ${fmtDateTime(new Date())}`,
				tree: tree.sha,
				parents: [head.sha],
			});
			// 更新分支（非 fast-forward 会 422，直接抛错不强推）
			await this.gh(`${this.repoBase()}/git/refs/heads/${encodeURIComponent(s.branch)}`, 'PATCH', {
				sha: commit.sha,
			});
			// 更新本地 manifest
			const nextFiles = { ...this.data.state.files };
			for (const p of [...created, ...modified]) nextFiles[p] = gitBlobSha(data[p]);
			for (const p of deleted) delete nextFiles[p];
			this.data.state = { headSha: commit.sha, treeSha: tree.sha, files: nextFiles, lastSyncAt: Date.now() };
			await this.save();
			new Notice(`已推送到 git：${total} 个变更`);
			this.refreshHome();
		} catch (e) {
			console.error(e);
			new Notice(`推送失败：${e instanceof Error ? e.message : e}`);
		} finally {
			this.syncing = false;
		}
	}

	/** 手动同步 = 下行 +（开了双向才）上行 */
	async fullSync(manual: boolean): Promise<void> {
		await this.pullSync(manual);
		if (this.data.settings.twoWay) await this.pushSync(false);
	}

	// ---------- 主页 / 长文 ----------

	async openHome(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HOME);
		if (leaves.length > 0) {
			this.app.workspace.revealLeaf(leaves[0]);
			return;
		}
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: VIEW_TYPE_HOME, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	refreshHome(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOME)) {
			const v = leaf.view;
			if (v instanceof HomeView) v.refresh();
		}
	}

	newNoteFlow(): void {
		const templates = this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith('templates/'))
			.sort((a, b) => a.basename.localeCompare(b.basename));
		if (templates.length === 0) {
			new Notice('templates/ 里没有模板：先同步一次把仓库模板拉下来');
			return;
		}
		new NewNoteModal(this.app, this, templates).open();
	}

	async openTodayDigest(): Promise<void> {
		const path = `digest/${fmtDate(new Date())}.md`;
		const f = this.app.vault.getAbstractFileByPath(path);
		if (f instanceof TFile) {
			await this.app.workspace.getLeaf(true).openFile(f);
		} else {
			new Notice('今日 digest 还没生成（每天 8:00）');
		}
	}
}

// ---------- 设置页 ----------

class MemexPadSyncSettingTab extends PluginSettingTab {
	private plugin: MemexPadSyncPlugin;

	constructor(app: import('obsidian').App, plugin: MemexPadSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.data.settings;

		containerEl.createEl('p', {
			text: '把 GitHub 上的 memex 仓库镜像到本 vault。iPhone 上建议关闭双向同步，只当只读镜像；iPad 上打开，即是写作机。',
		});

		new Setting(containerEl)
			.setName('双向同步（iPad 写作）')
			.setDesc('打开后：本地新建/修改/删除文件会在 60 秒后自动 push 到 git。关闭 = 只读镜像。')
			.addToggle((t) =>
				t.setValue(s.twoWay).onChange(async (v) => {
					s.twoWay = v;
					await this.plugin['save']();
				}),
			);

		new Setting(containerEl)
			.setName('启动时打开主页')
			.addToggle((t) =>
				t.setValue(s.openHomeOnStartup).onChange(async (v) => {
					s.openHomeOnStartup = v;
					await this.plugin['save']();
				}),
			);

		new Setting(containerEl).setName('owner').addText((t) =>
			t.setValue(s.owner).onChange(async (v) => {
				s.owner = v.trim();
				await this.plugin['save']();
			}),
		);
		new Setting(containerEl).setName('repo').addText((t) =>
			t.setValue(s.repo).onChange(async (v) => {
				s.repo = v.trim();
				await this.plugin['save']();
			}),
		);
		new Setting(containerEl).setName('branch').addText((t) =>
			t.setValue(s.branch).onChange(async (v) => {
				s.branch = v.trim() || 'main';
				await this.plugin['save']();
			}),
		);
		new Setting(containerEl)
			.setName('GitHub Token')
			.setDesc('fine-grained PAT：只授权本仓库，Contents 读（只读镜像）/ 读写（双向同步）。')
			.addText((t) => {
				t.inputEl.type = 'password';
				t.setValue(s.token).onChange(async (v) => {
					s.token = v.trim();
					await this.plugin['save']();
				});
			});
		new Setting(containerEl)
			.setName('启动时自动同步')
			.addToggle((t) =>
				t.setValue(s.syncOnStartup).onChange(async (v) => {
					s.syncOnStartup = v;
					await this.plugin['save']();
				}),
			);
	}
}
