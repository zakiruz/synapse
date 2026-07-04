import { App, TFile } from "obsidian";
import { BondIndex } from "./bondIndex";

/* The backlinks pane has no public API. We type the small internal surface
 * we touch structurally and reach it via unknown-casts; guarded and fails
 * soft: if internals change, bond notes simply reappear in Linked mentions.
 * Deliberately does NOT touch metadataCache.getBacklinksForFile — rename
 * link-updating may depend on it, and bonds must keep their atom links
 * updated on rename. */

interface SearchResultItemLike {
	el?: HTMLElement;
}

/** The internal result-list DOM whose addResult we wrap. */
interface SearchResultDomLike {
	addResult: (file: TFile | null, ...rest: unknown[]) => SearchResultItemLike | undefined;
	removeResult?: (file: TFile) => void;
}

/** The internal backlink component (sidebar pane and in-document). */
interface BacklinkComponentLike {
	backlinkDom?: SearchResultDomLike;
	recomputeBacklink?: (file: unknown) => void;
	file?: unknown;
}

interface BacklinkViewLike {
	backlink?: BacklinkComponentLike;
}

interface MarkdownViewWithBacklinks {
	backlinks?: BacklinkComponentLike;
}

/**
 * Filters bond notes out of the backlinks pane and the in-document
 * "Linked mentions" section.
 */
export class BacklinkFilter {
	private patched: Array<{ dom: SearchResultDomLike; original: SearchResultDomLike["addResult"] }> = [];

	constructor(
		private app: App,
		private index: BondIndex,
		private enabled: () => boolean,
	) {}

	private components(): BacklinkComponentLike[] {
		const out: BacklinkComponentLike[] = [];
		for (const leaf of this.app.workspace.getLeavesOfType("backlink")) {
			const view = leaf.view as unknown as BacklinkViewLike;
			if (view.backlink) out.push(view.backlink);
		}
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view as unknown as MarkdownViewWithBacklinks;
			if (view.backlinks) out.push(view.backlinks);
		}
		return out;
	}

	/** Wrap every open backlink component (sidebar pane + in-document). */
	patchAll(): void {
		for (const component of this.components()) {
			this.patchDom(component.backlinkDom);
		}
	}

	/** Recompute open backlink lists so the filter applies immediately. */
	refresh(): void {
		for (const component of this.components()) {
			try {
				component.recomputeBacklink?.(component.file);
			} catch {
				// internal signature changed; next natural recompute will apply
			}
		}
	}

	unpatchAll(): void {
		for (const { dom, original } of this.patched) {
			try {
				dom.addResult = original;
			} catch {
				// component already destroyed
			}
		}
		this.patched = [];
		this.refresh();
	}

	private patchDom(dom: SearchResultDomLike | undefined): void {
		if (!dom || typeof dom.addResult !== "function") return;
		if (this.patched.some((p) => p.dom === dom)) return;

		const original = dom.addResult;
		const enabled = this.enabled;
		const index = this.index;
		this.patched.push({ dom, original });
		dom.addResult = function (
			this: SearchResultDomLike,
			file: TFile | null,
			...rest: unknown[]
		): SearchResultItemLike | undefined {
			const item = original.call(this, file, ...rest);
			try {
				if (file && enabled() && index.isBond(file.path)) {
					if (typeof this.removeResult === "function") {
						this.removeResult(file);
					} else {
						item?.el?.detach();
					}
				}
			} catch (e) {
				console.error("Bonds: backlink filter failed", e);
			}
			return item;
		};
	}
}
