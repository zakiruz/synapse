import { App, Component, MarkdownRenderer, MarkdownView, Menu, TFile, setIcon } from "obsidian";
import { Bond, BondIndex } from "./bondIndex";
import type { SortOrder, SynapseSettings } from "./main";

interface FooterEl extends HTMLElement {
	_synapseComp?: Component;
}

interface FooterUiState {
	query: string;
	searchOpen: boolean;
}

const SORT_MENU: Array<Array<[SortOrder, string]>> = [
	[
		["alphabetical", "File name (A to Z)"],
		["alphabeticalReverse", "File name (Z to A)"],
	],
	[
		["byModifiedTime", "Modified time (new to old)"],
		["byModifiedTimeReverse", "Modified time (old to new)"],
	],
	[
		["byCreatedTime", "Created time (new to old)"],
		["byCreatedTimeReverse", "Created time (old to new)"],
	],
];

/**
 * Injects a rendered "Synapses" section at the bottom of every open markdown
 * view, styled after the core "backlinks in document" (Linked mentions) pane:
 * reading mode → .markdown-preview-sizer, editing mode → .cm-sizer.
 */
export class FooterManager {
	/** Transient per-file UI state (search box), survives re-renders. */
	private uiState = new Map<string, FooterUiState>();

	constructor(
		private app: App,
		private index: BondIndex,
		private settings: () => SynapseSettings,
		private save: () => Promise<void>,
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

		const bonds = this.sortBonds(this.index.bondsFor(file.path));
		if (bonds.length === 0) return;

		const parent = this.getParent(view);
		if (!parent) return;

		const state = this.uiState.get(file.path) ?? { query: "", searchOpen: false };
		this.uiState.set(file.path, state);

		const footer = document.createElement("div") as FooterEl;
		footer.classList.add("synapse-footer");
		if (this.settings().style === "minimal") footer.classList.add("synapse-style-minimal");
		const comp = new Component();
		footer._synapseComp = comp;
		comp.load();

		// Inline search box, hidden until toggled — mirrors the backlinks pane.
		const searchWrap = footer.createDiv({ cls: "synapse-search" });
		const searchContainer = searchWrap.createDiv({ cls: "search-input-container" });
		const searchInput = searchContainer.createEl("input", {
			type: "search",
			placeholder: "Search...",
		});
		searchInput.value = state.query;
		searchWrap.toggle(state.searchOpen);

		const allDetails = () => Array.from(footer.querySelectorAll<HTMLDetailsElement>("details.synapse-bond"));
		const applyFilter = () => {
			const q = state.query.trim().toLowerCase();
			for (const d of allDetails()) {
				d.toggle(q === "" || (d.dataset.search ?? "").includes(q));
			}
		};

		const heading = footer.createDiv({ cls: "synapse-footer-heading" });
		const title = heading.createDiv({ cls: "synapse-footer-title" });
		title.createSpan({ text: "Synapses" });
		title.createSpan({ cls: "synapse-count", text: String(bonds.length) });

		const buttons = heading.createDiv({ cls: "synapse-footer-buttons" });

		const toggleAll = buttons.createDiv({ cls: "clickable-icon synapse-toggle-all" });
		const refreshToggleLabel = () => {
			const anyClosed = allDetails().some((d) => !d.open);
			setIcon(toggleAll, anyClosed ? "chevrons-up-down" : "chevrons-down-up");
			toggleAll.setAttribute("aria-label", anyClosed ? "Expand all" : "Collapse all");
		};
		toggleAll.addEventListener("click", () => {
			const open = allDetails().some((d) => !d.open);
			for (const d of allDetails()) d.open = open;
			refreshToggleLabel();
		});
		// `toggle` doesn't bubble; capture keeps the label in sync with manual folds.
		footer.addEventListener("toggle", refreshToggleLabel, true);

		const sortBtn = buttons.createDiv({ cls: "clickable-icon" });
		setIcon(sortBtn, "arrow-up-narrow-wide");
		sortBtn.setAttribute("aria-label", "Change sort order");
		sortBtn.addEventListener("click", (evt) => this.showSortMenu(evt));

		const searchBtn = buttons.createDiv({ cls: "clickable-icon synapse-search-btn" });
		setIcon(searchBtn, "search");
		searchBtn.setAttribute("aria-label", "Search");
		searchBtn.toggleClass("is-active", state.searchOpen);
		searchBtn.addEventListener("click", () => {
			state.searchOpen = !state.searchOpen;
			searchWrap.toggle(state.searchOpen);
			searchBtn.toggleClass("is-active", state.searchOpen);
			if (state.searchOpen) {
				searchInput.focus();
			} else {
				state.query = "";
				searchInput.value = "";
				applyFilter();
			}
		});

		searchInput.addEventListener("input", () => {
			state.query = searchInput.value;
			applyFilter();
		});
		searchInput.addEventListener("keydown", (evt) => {
			if (evt.key === "Escape") searchBtn.click();
		});

		for (const bond of bonds) {
			void this.renderBond(footer, bond, file, comp, applyFilter);
		}
		refreshToggleLabel();
		applyFilter();

		// Internal links inside our custom container need their own click handling.
		// Native embeds handle their own clicks (and preventDefault), so we skip those.
		footer.addEventListener("click", (evt) => {
			if (evt.defaultPrevented) return;
			const target = (evt.target as HTMLElement).closest("a.internal-link");
			if (!target) return;
			evt.preventDefault();
			const href = target.getAttribute("data-href") ?? target.getAttribute("href");
			if (href) {
				void this.app.workspace.openLinkText(href, file.path, evt.metaKey || evt.ctrlKey);
			}
		});

		// Wire hover previews (page preview core plugin listens for this event).
		const hoverParent = { hoverPopover: null };
		footer.addEventListener("mouseover", (evt) => {
			const target = (evt.target as HTMLElement).closest("a.internal-link");
			if (!target) return;
			const linktext = target.getAttribute("data-href") ?? target.getAttribute("href");
			if (!linktext) return;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(this.app.workspace as any).trigger("hover-link", {
				event: evt,
				source: "synapse",
				hoverParent,
				targetEl: target,
				linktext,
				sourcePath: file.path,
			});
		});

		parent.appendChild(footer);
	}

	private sortBonds(bonds: Bond[]): Bond[] {
		const sorted = [...bonds];
		switch (this.settings().sortOrder) {
			case "alphabeticalReverse":
				sorted.sort((a, b) => b.file.basename.localeCompare(a.file.basename));
				break;
			case "byModifiedTime":
				sorted.sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
				break;
			case "byModifiedTimeReverse":
				sorted.sort((a, b) => a.file.stat.mtime - b.file.stat.mtime);
				break;
			case "byCreatedTime":
				sorted.sort((a, b) => b.file.stat.ctime - a.file.stat.ctime);
				break;
			case "byCreatedTimeReverse":
				sorted.sort((a, b) => a.file.stat.ctime - b.file.stat.ctime);
				break;
			default:
				sorted.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
		}
		return sorted;
	}

	private showSortMenu(evt: MouseEvent): void {
		const menu = new Menu();
		const current = this.settings().sortOrder;
		SORT_MENU.forEach((group, gi) => {
			if (gi > 0) menu.addSeparator();
			for (const [key, label] of group) {
				menu.addItem((item) =>
					item
						.setTitle(label)
						.setChecked(key === current)
						.onClick(() => {
							this.settings().sortOrder = key;
							void this.save();
						}),
				);
			}
		});
		menu.showAtMouseEvent(evt);
	}

	private async renderBond(
		footer: HTMLElement,
		bond: Bond,
		current: TFile,
		comp: Component,
		applyFilter?: () => void,
	): Promise<void> {
		const details = footer.createEl("details", { cls: "synapse-bond" });
		if (!this.settings().collapsedByDefault) details.setAttribute("open", "");

		const summary = details.createEl("summary", { cls: "synapse-bond-summary" });

		const others = bond.atomPaths.filter((p) => p !== current.path);
		const otherLabels: string[] = [];
		summary.createSpan({ cls: "synapse-bond-arrow", text: "–" });
		if (others.length === 0) {
			const title = summary.createEl("a", {
				cls: "internal-link synapse-bond-atom",
				text: bond.file.basename,
			});
			title.setAttribute("data-href", bond.file.path);
		}
		others.forEach((p, i) => {
			if (i > 0) summary.createSpan({ cls: "synapse-bond-arrow", text: "–" });
			const f = this.app.vault.getAbstractFileByPath(p);
			const label = f instanceof TFile ? f.basename : p;
			otherLabels.push(label);
			const link = summary.createEl("a", {
				cls: "internal-link synapse-bond-atom",
				text: label,
			});
			link.setAttribute("data-href", p);
		});

		if (bond.type) {
			summary.createSpan({ cls: "synapse-bond-type", text: bond.type });
		}

		const openLink = summary.createEl("a", { cls: "internal-link synapse-bond-open" });
		setIcon(openLink, "arrow-up-right");
		openLink.setAttribute("data-href", bond.file.path);
		openLink.setAttribute("aria-label", "Open bond");

		details.dataset.search = [bond.file.basename, ...otherLabels, bond.type ?? ""].join(" ").toLowerCase();

		const body = details.createDiv({ cls: "synapse-bond-body" });
		let markdown = await this.app.vault.cachedRead(bond.file);
		const fmPos = this.app.metadataCache.getFileCache(bond.file)?.frontmatterPosition;
		if (fmPos) {
			markdown = markdown.slice(fmPos.end.offset).trim();
		}
		details.dataset.search += " " + markdown.toLowerCase();
		applyFilter?.();

		if (markdown === "") {
			body.createDiv({ cls: "synapse-bond-empty", text: "(empty bond — open it to add content)" });
			return;
		}

		// Prefer Obsidian's native embed machinery — nested embeds, link clicks
		// and hover previews all behave exactly like a normal ![[embed]].
		if (this.renderNativeEmbed(body, bond, comp)) return;

		await MarkdownRenderer.render(this.app, markdown, body, bond.file.path, comp);
	}

	/**
	 * Mount the bond note as a real markdown embed (the same component Obsidian
	 * uses for ![[note]]). Relies on the undocumented embedRegistry, so it
	 * fails soft: returns false and the caller falls back to MarkdownRenderer.
	 */
	private renderNativeEmbed(body: HTMLElement, bond: Bond, comp: Component): boolean {
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const creator = (this.app as any).embedRegistry?.embedByExtension?.["md"];
			if (typeof creator !== "function") return false;

			const wrapper = body.createDiv({ cls: "internal-embed markdown-embed inline-embed synapse-embed" });
			wrapper.setAttribute("src", bond.file.basename);
			const child = creator(
				{ app: this.app, containerEl: wrapper, sourcePath: bond.file.path, showInline: true, depth: 0 },
				bond.file,
				"",
			);
			if (!child) {
				wrapper.remove();
				return false;
			}
			comp.addChild(child);
			child.loadFile?.();
			return true;
		} catch (e) {
			console.error("Synapse: native embed failed, using fallback renderer", e);
			return false;
		}
	}
}
