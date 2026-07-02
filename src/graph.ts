import { App } from "obsidian";
import { BondIndex } from "./bondIndex";

/* The graph view has no public API, so this reaches into the internal
 * renderer. Everything is guarded and fails soft: if Obsidian's internals
 * change, graphs simply show bond notes as ordinary nodes again. */
/* eslint-disable @typescript-eslint/no-explicit-any */

interface GraphNodeData {
	links: Record<string, boolean>;
	[key: string]: unknown;
}

interface GraphData {
	nodes: Record<string, GraphNodeData>;
	[key: string]: unknown;
}

const GRAPH_VIEW_TYPES = ["graph", "localgraph"];

/**
 * Hides bond notes from graph views and replaces them with direct
 * atom-to-atom edges, so bonds read as connections rather than nodes.
 */
export class GraphFilter {
	private patched: Array<{ renderer: any; original: (data: GraphData) => void }> = [];

	constructor(
		private app: App,
		private index: BondIndex,
		private enabled: () => boolean,
	) {}

	patchOpenGraphs(): void {
		for (const type of GRAPH_VIEW_TYPES) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				this.patchRenderer((leaf.view as any)?.renderer);
			}
		}
	}

	refreshGraphs(): void {
		for (const type of GRAPH_VIEW_TYPES) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				try {
					(leaf.view as any)?.dataEngine?.render?.();
				} catch (e) {
					console.error("Synapse: graph refresh failed", e);
				}
			}
		}
	}

	unpatchAll(): void {
		for (const { renderer, original } of this.patched) {
			try {
				renderer.setData = original;
			} catch {
				// renderer already destroyed
			}
		}
		this.patched = [];
		this.refreshGraphs();
	}

	private patchRenderer(renderer: any): void {
		if (!renderer || typeof renderer.setData !== "function") return;
		if (this.patched.some((p) => p.renderer === renderer)) return;

		const original = renderer.setData;
		this.patched.push({ renderer, original });
		renderer.setData = (data: GraphData) => {
			try {
				data = this.transform(data);
			} catch (e) {
				console.error("Synapse: graph transform failed", e);
			}
			return original.call(renderer, data);
		};
	}

	/** Remove bond nodes; connect each bond's atoms to each other directly. */
	private transform(data: GraphData): GraphData {
		if (!this.enabled() || !data?.nodes) return data;
		const nodes = data.nodes;

		const bondPaths = Object.keys(nodes).filter((p) => this.index.isBond(p));
		for (const bondPath of bondPaths) {
			const bond = this.index.getBond(bondPath);
			const atoms = (bond?.atomPaths ?? Object.keys(nodes[bondPath].links)).filter(
				(a) => a !== bondPath && a in nodes,
			);

			for (let i = 0; i < atoms.length; i++) {
				for (let j = i + 1; j < atoms.length; j++) {
					nodes[atoms[i]].links[atoms[j]] = true;
				}
			}

			delete nodes[bondPath];
			for (const p of Object.keys(nodes)) {
				delete nodes[p].links[bondPath];
			}
		}
		return data;
	}
}
