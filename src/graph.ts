import { App } from "obsidian";
import { BondIndex } from "./bondIndex";

/* The graph view has no public API. We type the small internal surface we
 * touch structurally and reach it via unknown-casts; everything is guarded
 * and fails soft: if Obsidian's internals change, graphs simply show bond
 * notes as ordinary nodes again. */

interface GraphNodeData {
	links: Record<string, boolean>;
}

interface GraphData {
	nodes?: Record<string, GraphNodeData>;
}

/** The internal renderer whose data feed we intercept. */
interface InternalGraphRenderer {
	setData: (data: GraphData) => unknown;
}

/** The internal shape of graph/localgraph views. */
interface InternalGraphView {
	renderer?: InternalGraphRenderer;
	dataEngine?: {
		render?: () => void;
	};
}

const GRAPH_VIEW_TYPES = ["graph", "localgraph"];

/**
 * Hides bond notes from graph views and replaces them with direct
 * atom-to-atom edges, so bonds read as connections rather than nodes.
 */
export class GraphFilter {
	private patched: Array<{ renderer: InternalGraphRenderer; original: (data: GraphData) => unknown }> = [];

	constructor(
		private app: App,
		private index: BondIndex,
		private enabled: () => boolean,
	) {}

	private graphViews(): InternalGraphView[] {
		const views: InternalGraphView[] = [];
		for (const type of GRAPH_VIEW_TYPES) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				views.push(leaf.view as unknown as InternalGraphView);
			}
		}
		return views;
	}

	patchOpenGraphs(): void {
		for (const view of this.graphViews()) {
			this.patchRenderer(view.renderer);
		}
	}

	refreshGraphs(): void {
		for (const view of this.graphViews()) {
			try {
				view.dataEngine?.render?.();
			} catch (e) {
				console.error("Bonds: graph refresh failed", e);
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

	private patchRenderer(renderer: InternalGraphRenderer | undefined): void {
		if (!renderer || typeof renderer.setData !== "function") return;
		if (this.patched.some((p) => p.renderer === renderer)) return;

		const original = renderer.setData;
		this.patched.push({ renderer, original });
		renderer.setData = (data: GraphData) => {
			try {
				data = this.transform(data);
			} catch (e) {
				console.error("Bonds: graph transform failed", e);
			}
			return original.call(renderer, data);
		};
	}

	/** Remove bond nodes; connect each bond's atoms to each other directly. */
	private transform(data: GraphData): GraphData {
		const nodes = data.nodes;
		if (!this.enabled() || !nodes) return data;

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
