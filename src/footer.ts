import { App, Component, MarkdownRenderer, MarkdownView, TFile } from "obsidian";
import { Bond, BondIndex } from "./bondIndex";
import type { SynapseSettings } from "./main";

interface FooterEl extends HTMLElement {
	_synapseComp?: Component;
}

/**
 * Injects a rendered "Bonds" section at the bottom of every open markdown view,
 * mirroring the core "backlinks in document" placement:
 * reading mode → .markdown-preview-sizer, editing mode → .cm-sizer.
 */
export class FooterManager {
	constructor(
		private app: App,
		private index: BondIndex,
		private settings: () => SynapseSettings,
	) {}

	refreshAll(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView) this.update(view);
		}
	}

	removeAll(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView) this.remove(view);
		}
	}

	private remove(view: MarkdownView): void {
		view.containerEl.querySelectorAll<FooterEl>(".synapse-footer").forEach((el) => {
			el._synapseComp?.unload();
			el.remove();
		});
	}

	private getParent(view: MarkdownView): HTMLElement | null {
		if (view.getMode() === "preview") {
			return (
				view.containerEl.querySelector<HTMLElement>(".markdown-preview-view .markdown-preview-sizer") ??
				view.containerEl.querySelector<HTMLElement>(".markdown-preview-view")
			);
		}
		return view.containerEl.querySelector<HTMLElement>(".cm-editor .cm-sizer");
	}

	update(view: MarkdownView): void {
		this.remove(view);
		if (!this.settings().showFooter) return;

		const file = view.file;
		if (!file) return;
		// Bond notes don't get a bonds footer of their own.
		if (this.index.isBond(file.path)) return;

		const bonds = this.index.bondsFor(file.path);
		if (bonds.length === 0) return;

		const parent = this.getParent(view);
		if (!parent) return;

		const footer = document.createElement("div") as FooterEl;
		footer.classList.add("synapse-footer");
		const comp = new Component();
		footer._synapseComp = comp;
		comp.load();

		const heading = footer.createDiv({ cls: "synapse-footer-heading" });
		heading.setText(`⚛ Bonds (${bonds.length})`);

		for (const bond of bonds) {
			void this.renderBond(footer, bond, file, comp);
		}

		// Internal links inside our custom container need their own click handling.
		footer.addEventListener("click", (evt) => {
			const target = (evt.target as HTMLElement).closest("a.internal-link");
			if (!target) return;
			evt.preventDefault();
			const href = target.getAttribute("data-href") ?? target.getAttribute("href");
			if (href) {
				void this.app.workspace.openLinkText(href, file.path, evt.metaKey || evt.ctrlKey);
			}
		});

		parent.appendChild(footer);
	}

	private async renderBond(footer: HTMLElement, bond: Bond, current: TFile, comp: Component): Promise<void> {
		const details = footer.createEl("details", { cls: "synapse-bond" });
		if (!this.settings().collapsedByDefault) details.setAttribute("open", "");

		const summary = details.createEl("summary", { cls: "synapse-bond-summary" });

		const others = bond.atomPaths.filter((p) => p !== current.path);
		summary.createSpan({ cls: "synapse-bond-arrow", text: "↔" });
		if (others.length === 0) {
			const title = summary.createEl("a", {
				cls: "internal-link synapse-bond-atom",
				text: bond.file.basename,
			});
			title.setAttribute("data-href", bond.file.path);
		}
		others.forEach((p, i) => {
			if (i > 0) summary.createSpan({ cls: "synapse-bond-arrow", text: "↔" });
			const f = this.app.vault.getAbstractFileByPath(p);
			const link = summary.createEl("a", {
				cls: "internal-link synapse-bond-atom",
				text: f instanceof TFile ? f.basename : p,
			});
			link.setAttribute("data-href", p);
		});

		if (bond.type) {
			summary.createSpan({ cls: "synapse-bond-type", text: bond.type });
		}

		const openLink = summary.createEl("a", {
			cls: "internal-link synapse-bond-open",
			text: "open bond",
		});
		openLink.setAttribute("data-href", bond.file.path);

		const body = details.createDiv({ cls: "synapse-bond-body" });
		let markdown = await this.app.vault.cachedRead(bond.file);
		const fmPos = this.app.metadataCache.getFileCache(bond.file)?.frontmatterPosition;
		if (fmPos) {
			markdown = markdown.slice(fmPos.end.offset).trim();
		}
		if (markdown === "") {
			body.createDiv({ cls: "synapse-bond-empty", text: "(empty bond — open it to add content)" });
			return;
		}
		await MarkdownRenderer.render(this.app, markdown, body, bond.file.path, comp);
	}
}
