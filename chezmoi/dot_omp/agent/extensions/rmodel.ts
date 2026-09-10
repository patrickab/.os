import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const MAX_RECENT_MODELS = 20;
const HISTORY_PATH = `${Bun.env.PI_CODING_AGENT_DIR ?? `${Bun.env.HOME}/.omp/agent`}/extensions/rmodel-history.json`;

async function loadRecentModels(): Promise<string[]> {
	try {
		const value: unknown = await Bun.file(HISTORY_PATH).json();
		return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
	} catch {
		return [];
	}
}

async function saveRecentModel(model: string, recent: readonly string[]): Promise<void> {
	await Bun.write(HISTORY_PATH, JSON.stringify([model, ...recent.filter(entry => entry !== model)].slice(0, MAX_RECENT_MODELS)));
}

export default function recentModelExtension(pi: ExtensionAPI): void {
	pi.registerCommand("rmodel", {
		description: "Fuzzy-select a recent model; provider shown for every result",
		handler: async (_args, ctx) => {
		if (!ctx.hasUI) return;

		const recent = await loadRecentModels();
		const recentRank = new Map(recent.map((selector, index) => [selector, index]));
		const models = [...ctx.models.list()].sort((a, b) => {
			const aSelector = `${a.provider}/${a.id}`;
			const bSelector = `${b.provider}/${b.id}`;
			const rank = (recentRank.get(aSelector) ?? Number.POSITIVE_INFINITY) - (recentRank.get(bSelector) ?? Number.POSITIVE_INFINITY);
			return rank || a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id);
		});
		if (models.length === 0) {
			ctx.ui.notify("No authenticated models are available.", "warning");
			return;
		}

		const bySelector = new Map(models.map(model => [`${model.provider}/${model.id}`, model]));
		const selected = await ctx.ui.select(
			"Recent model",
			models.map(model => ({ label: `${model.provider}/${model.id}`, description: `Provider: ${model.provider}` })),
		);
		const model = selected ? bySelector.get(selected) : undefined;
		if (!model) return;
		if (!(await pi.setModel(model))) {
			ctx.ui.notify(`No usable credential for ${model.provider}/${model.id}.`, "error");
			return;
		}
		await saveRecentModel(`${model.provider}/${model.id}`, recent);
		ctx.ui.notify(`Model set to ${model.provider}/${model.id}.`, "info");
	},
	});
}
