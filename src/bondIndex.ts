import { App, TFile, debounce } from "obsidian";

export interface Bond {
	file: TFile;
	/** Resolved vault paths of the atoms this bond connects. */
	atomPaths: string[];
	type: string | null;
}

const LINK_RE = /\[\[([^\]|#]+)/;

function parseAtomLink(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const m = raw.match(LINK_RE);
	if (m) return m[1].trim();
	const bare = raw.trim();
	return bare.length > 0 ? bare : null;
}

/**
 * In-memory index of all bond notes in the vault.
 * A bond is any markdown file whose frontmatter contains `synapse: bond`
 * and an `atoms` list of wiki-links.
 */
export class BondIndex {
	private bonds = new Map<string, Bond>();
	private byAtom = new Map<string, Set<string>>();
	private onRebuilt: () => void;
	requestRebuild: () => void;

	constructor(private app: App, onRebuilt: () => void) {
		this.onRebuilt = onRebuilt;
		this.requestRebuild = debounce(() => this.rebuild(), 400, true);
	}

	isBond(path: string): boolean {
		return this.bonds.has(path);
	}

	getBond(path: string): Bond | undefined {
		return this.bonds.get(path);
	}

	bondsFor(atomPath: string): Bond[] {
		const set = this.byAtom.get(atomPath);
		if (!set) return [];
		const out: Bond[] = [];
		for (const p of set) {
			const b = this.bonds.get(p);
			if (b) out.push(b);
		}
		out.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
		return out;
	}

	rebuild(): void {
		this.bonds.clear();
		this.byAtom.clear();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm || fm["synapse"] !== "bond") continue;

			const fmAtoms: unknown = fm["atoms"];
			const rawAtoms: unknown[] = Array.isArray(fmAtoms) ? fmAtoms : fmAtoms != null ? [fmAtoms] : [];

			const atomPaths: string[] = [];
			for (const raw of rawAtoms) {
				const linkpath = parseAtomLink(raw);
				if (!linkpath) continue;
				const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
				if (dest) atomPaths.push(dest.path);
			}
			if (atomPaths.length === 0) continue;

			const type = typeof fm["type"] === "string" && fm["type"].trim() !== "" ? fm["type"].trim() : null;
			const bond: Bond = { file, atomPaths, type };
			this.bonds.set(file.path, bond);
			for (const atom of atomPaths) {
				let set = this.byAtom.get(atom);
				if (!set) {
					set = new Set();
					this.byAtom.set(atom, set);
				}
				set.add(file.path);
			}
		}
		this.onRebuilt();
	}
}
