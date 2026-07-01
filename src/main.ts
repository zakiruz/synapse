import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, debounce } from "obsidian";
import { BondIndex } from "./bondIndex";
import { FooterManager } from "./footer";
import { AtomSuggestModal, createBond } from "./createBond";

export interface SynapseSettings {
	bondsFolder: string;
	collapsedByDefault: boolean;
	showFooter: boolean;
}

const DEFAULT_SETTINGS: SynapseSettings = {
	bondsFolder: "Bonds",
	collapsedByDefault: false,
	showFooter: true,
};

export default class SynapsePlugin extends Plugin {
	settings: SynapseSettings = DEFAULT_SETTINGS;
	index!: BondIndex;
	footer!: FooterManager;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.index = new BondIndex(this.app, () => this.footer.refreshAll());
		this.footer = new FooterManager(this.app, this.index, () => this.settings);

		const refresh = debounce(() => this.footer.refreshAll(), 250, true);

		this.app.workspace.onLayoutReady(() => this.index.rebuild());
		this.registerEvent(this.app.metadataCache.on("resolved", () => this.index.requestRebuild()));
		this.registerEvent(this.app.metadataCache.on("changed", () => this.index.requestRebuild()));
		this.registerEvent(this.app.vault.on("delete", () => this.index.requestRebuild()));
		this.registerEvent(this.app.vault.on("rename", () => this.index.requestRebuild()));

		this.registerEvent(this.app.workspace.on("file-open", refresh));
		this.registerEvent(this.app.workspace.on("layout-change", refresh));

		this.addCommand({
			id: "create-bond",
			name: "Create bond from current note",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				const file = view?.file;
				if (!file) return false;
				if (checking) return true;
				new AtomSuggestModal(this.app, file, (other) => {
					void createBond(this.app, this.settings.bondsFolder, file, other);
				}).open();
				return true;
			},
		});

		this.addCommand({
			id: "rebuild-index",
			name: "Rebuild bond index",
			callback: () => {
				this.index.rebuild();
				new Notice("Synapse: bond index rebuilt");
			},
		});

		this.addSettingTab(new SynapseSettingTab(this.app, this));
	}

	onunload(): void {
		this.footer.removeAll();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
			.setName("Show bonds in notes")
			.setDesc("Render a Bonds section at the bottom of notes that have bonds.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showFooter).onChange(async (value) => {
					this.plugin.settings.showFooter = value;
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
	}
}
