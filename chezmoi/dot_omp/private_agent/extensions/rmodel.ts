import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const MAX_RECENT_MODELS = 20;
const AGENT_DIR = Bun.env.PI_CODING_AGENT_DIR ?? `${Bun.env.HOME}/.omp/agent`;
const HISTORY_PATH = join(AGENT_DIR, "extensions", "rmodel-history.json");
const SESSIONS_PATH = join(AGENT_DIR, "sessions");

type SessionEntry = {
	timestamp?: unknown;
	type?: unknown;
	provider?: unknown;
	modelId?: unknown;
	message?: { role?: unknown; provider?: unknown; model?: unknown };
};

function selector(provider: unknown, model: unknown): string | undefined {
	return typeof provider === "string" && typeof model === "string" ? `${provider}/${model}` : undefined;
}

function uniqueRecent(models: Iterable<string>): string[] {
	return [...new Set(models)].slice(0, MAX_RECENT_MODELS);
}

async function recentModelsFromSessions(): Promise<string[]> {
	const used: { selector: string; timestamp: string }[] = [];
	try {
		for await (const path of new Bun.Glob("**/*.jsonl").scan({ cwd: SESSIONS_PATH, onlyFiles: true })) {
			for (const line of (await Bun.file(join(SESSIONS_PATH, path)).text()).split("\n")) {
				try {
					const entry = JSON.parse(line) as SessionEntry;
					const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
					const usedModel = entry.type === "model_change"
						? selector(entry.provider, entry.modelId)
						: entry.type === "message" && entry.message?.role === "assistant"
							? selector(entry.message.provider, entry.message.model)
							: undefined;
					if (timestamp && usedModel) used.push({ selector: usedModel, timestamp });
				} catch {
					// Ignore incomplete session records from an active OMP session.
				}
			}
		}
	} catch (error) {
		console.warn("Could not read model history from OMP sessions:", error);
	}
	return uniqueRecent(used.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).map(({ selector }) => selector));
}

async function loadRecentModels(): Promise<string[]> {
	const file = Bun.file(HISTORY_PATH);
	if (!(await file.exists())) return recentModelsFromSessions();
	try {
		const value: unknown = await file.json();
		return Array.isArray(value) ? uniqueRecent(value.filter((entry): entry is string => typeof entry === "string")) : [];
	} catch {
		return recentModelsFromSessions();
	}
}

async function saveRecentModel(model: string): Promise<void> {
	await Bun.write(HISTORY_PATH, JSON.stringify(uniqueRecent([model, ...(await loadRecentModels())])));
}

let pendingHistoryUpdate = Promise.resolve();

function rememberModel(model: string): Promise<void> {
	pendingHistoryUpdate = pendingHistoryUpdate.then(() => saveRecentModel(model)).catch(error => {
		console.warn("Could not save recent model history:", error);
	});
	return pendingHistoryUpdate;
}

export default function recentModelExtension(pi: ExtensionAPI): void {
	pi.on("model_select", async (event) => {
		await rememberModel(`${event.model.provider}/${event.model.id}`);
	});

	pi.registerCommand("rmodel", {
		description: "Fuzzy-select a recently used model; provider shown for every result",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;

			const available = new Map([...ctx.models.list()].map(model => [`${model.provider}/${model.id}`, model]));
			const models = (await loadRecentModels()).map(model => available.get(model)).filter(model => model !== undefined);
			if (models.length === 0) {
				ctx.ui.notify("No recently used authenticated models are available.", "warning");
				return;
			}

			const choices = models.map(model => ({
				selector: `${model.provider}/${model.id}`,
				label: `${model.provider} - ${model.id}`,
			}));
			const selected = await ctx.ui.select("Recent model", choices.map(({ label }) => label));
			const model = selected ? available.get(choices.find(choice => choice.label === selected)?.selector ?? "") : undefined;
			if (!model) return;
			if (!(await pi.setModel(model))) {
				ctx.ui.notify(`No usable credential for ${model.provider}/${model.id}.`, "error");
				return;
			}
			ctx.ui.notify(`Model set to ${model.provider}/${model.id}.`, "info");
		},
	});
}
