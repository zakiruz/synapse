import { App } from "obsidian";
import { BondIndex } from "./bondIndex";

/* The backlinks pane has no public API, so this wraps the internal
 * SearchResultDom.addResult on each backlink component. Guarded and
 * fails soft: if internals change, bond notes simply reappear in
 * Linked mentions. Deliberately does NOT touch
 * metadataCache.getBacklinksForFile — rename link-updating may depend
 * on it, and bonds must keep their atom links updated on rename. */
/* eslint-disable @typescript-eslint/no-explicit-any */

export class BacklinkFilter {
	private patched: Array<{ dom: any; original: any }> = [];

	constructor(
		private app: App,
		private index: BondIndex,
		private enabled: () => boolean,
	) {}

	/** Wrap every open backlink component (sidebar pane + in-document). */
	patchAll(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("backlink")) {
			this.patchDom((leaf.view as any)?.backlink?.backlinkDom);
		}
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			this.patchDom((leaf.view as any)?.backlinks?.backlinkDom);
		}
	}

	/** Recompute open backlink lists so the filter applies immediately. */
	refresh(): void {
		const recompute = (bl: any) => {
			try {
				bl?.recomputeBacklink?.(bl?.file);
			} catch {
				// internal signature changed; next natural recompute will apply
			}
		};
		for (const leaf of this.app.workspace.getLeavesOfType("backlink")) {
			recompute((leaf.view as any)?.backlink);
		}
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			recompute((leaf.view as any)?.backlinks);
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

	private patchDom(dom: any): void {
		if (!dom || typeof dom.addResult !== "function") return;
		if (this.patched.some((p) => p.dom === dom)) return;

		const original = dom.addResult;
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;
		this.patched.push({ dom, original });
		dom.addResult = function (file: any, ...rest: any[]) {
			const item = original.call(this, file, ...rest);
			try {
				if (self.enabled() && file?.path && self.index.isBond(file.path)) {
					if (typeof this.removeResult === "function") {
						this.removeResult(file);
					} else {
						item?.el?.detach?.();
					}
				}
			} catch (e) {
				console.error("Bonds: backlink filter failed", e);
			}
			return item;
		};
	}
}
