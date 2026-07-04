import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, debounce } from "obsidian";
import { BondIndex } from "./bondIndex";
import { FooterManager } from "./footer";
import { GraphFilter } from "./graph";
import { BacklinkFilter } from "./backlinks";
import { AtomSuggestModal, createBond } from "./createBond";

export type SortOrder =
	| "alphabetical"
	| "alphabeticalReverse"
	| "byModifiedTime"
	| "byModifiedTimeReverse"
	| "byCreatedTime"
	| "byCreatedTimeReverse";

export interface SynapseSettings {
	bondsFolder: string;
	collapsedByDefault: boolean;
	showFooter: boolean;
	style: "card" | "minimal";
	hideBondsInGraph: boolean;
	hideBondsInBacklinks: boolean;
	sortOrder: SortOrder;
	sectionHeading: string;
}

const DEFAULT_SETTINGS: SynapseSettings = {
	bondsFolder: "Bonds",
	collapsedByDefault: false,
	showFooter: true,
	style: "minimal",
	hideBondsInGraph: true,
	hideBondsInBacklinks: true,
	sortOrder: "alphabetical",
	sectionHeading: "Synapses",
};

/** Return the linkpath of the [[wiki-link]] spanning column `ch` on `line`, if any. */
function findWikiLinkAt(line: string, ch: number): string | null {
	const re = /\[\[([^\]|#]+)(?:[^\]]*)\]\]/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(line)) !== null) {
		if (ch >= m.index && ch <= m.index + m[0].length) {
			return m[1].trim();
		}
	}
	return null;
}

export default class SynapsePlugin extends Plugin {
	settings: SynapseSettings = DEFAULT_SETTINGS;
	index!: BondIndex;
	footer!: FooterManager;
	graph!: GraphFilter;
	backlinks!: BacklinkFilter;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.index = new BondIndex(this.app, () => {
			this.footer.refreshAll();
			this.graph.refreshGraphs();
			this.backlinks.patchAll();
			this.backlinks.refresh();
		});
		this.footer = new FooterManager(
			this.app,
			this.index,
			() => this.settings,
			() => this.saveSettings(),
		);
		this.graph = new GraphFilter(this.app, this.index, () => this.settings.hideBondsInGraph);
		this.backlinks = new BacklinkFilter(this.app, this.index, () => this.settings.hideBondsInBacklinks);

		const refresh = debounce(() => this.footer.refreshAll(), 250, true);

		this.app.workspace.onLayoutReady(() => {
			this.index.rebuild();
			this.graph.patchOpenGraphs();
			this.graph.refreshGraphs();
			this.backlinks.patchAll();
		});
		this.registerEvent(this.app.metadataCache.on("resolved", () => this.index.requestRebuild()));
		this.registerEvent(this.app.metadataCache.on("changed", () => this.index.requestRebuild()));
		this.registerEvent(this.app.vault.on("delete", () => this.index.requestRebuild()));
		this.registerEvent(this.app.vault.on("rename", () => this.index.requestRebuild()));

		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				refresh();
				this.backlinks.patchAll();
			}),
		);
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				refresh();
				this.graph.patchOpenGraphs();
				this.backlinks.patchAll();
			}),
		);

		this.addCommand({
			id: "create-bond",
			name: "Create bond from current note",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				const file = view?.file;
				if (!file) return false;
				if (checking) return true;
				this.openBondPicker(file);
				return true;
			},
		});

		// Right-click on a file in the explorer or a tab header.
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				menu.addItem((item) =>
					item
						.setTitle("Create bond…")
						.setIcon("atom")
						.onClick(() => this.openBondPicker(file)),
				);
			}),
		);

		// Multi-select in the explorer: bond all selected notes in one go.
		this.registerEvent(
			this.app.workspace.on("files-menu", (menu, files) => {
				const mdFiles = files.filter((f): f is TFile => f instanceof TFile && f.extension === "md");
				if (mdFiles.length < 2) return;
				menu.addItem((item) =>
					item
						.setTitle(`Create bond between ${mdFiles.length} notes`)
						.setIcon("atom")
						.onClick(() => void createBond(this.app, this.settings.bondsFolder, mdFiles)),
				);
			}),
		);

		// Right-click inside the editor. When on a [[wiki-link]], offer a
		// direct bond with that target — the "promote this link" flow.
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				const file = view.file;
				if (!file) return;

				const cursor = editor.getCursor();
				const linkpath = findWikiLinkAt(editor.getLine(cursor.line), cursor.ch);
				if (linkpath) {
					const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
					if (dest && dest.path !== file.path) {
						menu.addItem((item) =>
							item
								.setTitle(`Bond with "${dest.basename}"`)
								.setIcon("atom")
								.onClick(() => void createBond(this.app, this.settings.bondsFolder, [file, dest])),
						);
					}
				}

				menu.addItem((item) =>
					item
						.setTitle("Create bond…")
						.setIcon("atom")
						.onClick(() => this.openBondPicker(file)),
				);
			}),
		);

		this.addCommand({
			id: "rebuild-index",
			name: "Rebuild bond index",
			callback: () => {
				this.index.rebuild();
				new Notice("Bonds: bond index rebuilt");
			},
		});

		this.addSettingTab(new SynapseSettingTab(this.app, this));
	}

	onunload(): void {
		this.footer.removeAll();
		this.graph.unpatchAll();
		this.backlinks.unpatchAll();
	}

	private openBondPicker(file: TFile): void {
		new AtomSuggestModal(this.app, [file], (atoms) => {
			void createBond(this.app, this.settings.bondsFolder, atoms);
		}).open();
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<SynapseSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.footer.refreshAll();
	}
}

class SynapseSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: SynapsePlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Bonds folder")
			.setDesc("New bond notes are created here.")
			.addText((text) =>
				text
					.setPlaceholder("Bonds")
					.setValue(this.plugin.settings.bondsFolder)
					.onChange(async (value) => {
						this.plugin.settings.bondsFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Section heading")
			.setDesc("Title of the rendered bonds section at the bottom of notes.")
			.addText((text) =>
				text
					.setPlaceholder("Synapses")
					.setValue(this.plugin.settings.sectionHeading)
					.onChange(async (value) => {
						this.plugin.settings.sectionHeading = value.trim() || "Synapses";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Show bonds in notes")
			.setDesc("Render a Bonds section at the bottom of notes that have bonds.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showFooter).onChange(async (value) => {
					this.plugin.settings.showFooter = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Bond style")
			.setDesc("Card: each bond in its own box. Minimal: flat list separated by lines.")
			.addDropdown((dd) =>
				dd
					.addOption("card", "Card")
					.addOption("minimal", "Minimal")
					.setValue(this.plugin.settings.style)
					.onChange(async (value) => {
						this.plugin.settings.style = value as "card" | "minimal";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Collapse bonds by default")
			.setDesc("Bond content starts collapsed; click to expand.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.collapsedByDefault).onChange(async (value) => {
					this.plugin.settings.collapsedByDefault = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Hide bonds in graph view")
			.setDesc("Bond notes disappear from the graph; their atoms are shown linked directly to each other instead.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.hideBondsInGraph).onChange(async (value) => {
					this.plugin.settings.hideBondsInGraph = value;
					await this.plugin.saveSettings();
					this.plugin.graph.patchOpenGraphs();
					this.plugin.graph.refreshGraphs();
				}),
			);

		new Setting(containerEl)
			.setName("Hide bonds in linked mentions")
			.setDesc("Bond notes are filtered out of the backlinks pane and the Linked mentions section.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.hideBondsInBacklinks).onChange(async (value) => {
					this.plugin.settings.hideBondsInBacklinks = value;
					await this.plugin.saveSettings();
					this.plugin.backlinks.patchAll();
					this.plugin.backlinks.refresh();
				}),
			);
	}
}
