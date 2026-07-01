import { App, FuzzySuggestModal, Notice, TFile, normalizePath } from "obsidian";

/**
 * Fuzzy picker that collects one or more atoms for a bond.
 * Enter picks the final atom and creates the bond;
 * Shift+Enter adds the atom and keeps the picker open for more.
 */
export class AtomSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private chain: TFile[],
		private onDone: (atoms: TFile[]) => void,
	) {
		super(app);
		this.setPlaceholder(`${chain.map((f) => f.basename).join(" ↔ ")} ↔ …`);
		this.setInstructions([
			{ command: "↵", purpose: "add atom and create bond" },
			{ command: "shift ↵", purpose: "add atom, keep picking" },
		]);
	}

	getItems(): TFile[] {
		const taken = new Set(this.chain.map((f) => f.path));
		return this.app.vault.getMarkdownFiles().filter((f) => !taken.has(f.path));
	}

	getItemText(f: TFile): string {
		return f.path;
	}

	onChooseItem(f: TFile, evt: MouseEvent | KeyboardEvent): void {
		const chain = [...this.chain, f];
		if (evt.shiftKey) {
			new AtomSuggestModal(this.app, chain, this.onDone).open();
		} else {
			this.onDone(chain);
		}
	}
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(folder);
	if (!existing) {
		await app.vault.createFolder(folder);
	}
}

/** Create a bond note connecting two or more atoms and open it in a new tab. */
export async function createBond(app: App, bondsFolder: string, atoms: TFile[]): Promise<void> {
	if (atoms.length < 2) {
		new Notice("Synapse: a bond needs at least two atoms");
		return;
	}
	const folder = normalizePath(bondsFolder.trim() || "Bonds");
	await ensureFolder(app, folder);

	const base = atoms.map((a) => a.basename).join(" ↔ ");
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
		...atoms.map((a) => `  - "[[${a.basename}]]"`),
		"type: ",
		"---",
		"",
		"",
	].join("\n");

	const file = await app.vault.create(path, content);
	await app.workspace.getLeaf("tab").openFile(file);
	new Notice(`Bond created: ${base}`);
}
