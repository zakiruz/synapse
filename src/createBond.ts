import { App, FuzzySuggestModal, Notice, TFile, normalizePath } from "obsidian";

export class AtomSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private exclude: TFile,
		private onPick: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder("Bond with which note?");
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles().filter((f) => f.path !== this.exclude.path);
	}

	getItemText(f: TFile): string {
		return f.path;
	}

	onChooseItem(f: TFile): void {
		this.onPick(f);
	}
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(folder);
	if (!existing) {
		await app.vault.createFolder(folder);
	}
}

/** Create a bond note between two atoms and open it in a new tab. */
export async function createBond(app: App, bondsFolder: string, a: TFile, b: TFile): Promise<void> {
	const folder = normalizePath(bondsFolder.trim() || "Bonds");
	await ensureFolder(app, folder);

	const base = `${a.basename} ↔ ${b.basename}`;
	let path = normalizePath(`${folder}/${base}.md`);
	let n = 1;
	while (app.vault.getAbstractFileByPath(path)) {
		path = normalizePath(`${folder}/${base} ${n}.md`);
		n++;
	}

	const content = [
		"---",
		"synapse: bond",
		"atoms:",
		`  - "[[${a.basename}]]"`,
		`  - "[[${b.basename}]]"`,
		"type: ",
		"---",
		"",
		"",
	].join("\n");

	const file = await app.vault.create(path, content);
	await app.workspace.getLeaf("tab").openFile(file);
	new Notice(`Bond created: ${a.basename} ↔ ${b.basename}`);
}
