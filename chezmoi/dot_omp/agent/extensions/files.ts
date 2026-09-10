import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { appendFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const STATE_DIR = `${Bun.env.PI_CODING_AGENT_DIR ?? `${Bun.env.HOME}/.omp/agent`}/extensions/files`;
const STATE_FILE = `${STATE_DIR}/${process.pid}.jsonl`;

type Change = { path: string };

function inputPath(input: Record<string, unknown>): string | undefined {
	return typeof input.path === "string" ? input.path : undefined;
}

async function record(path: string): Promise<void> {
	await appendFile(STATE_FILE, `${JSON.stringify({ path: resolve(path) } satisfies Change)}\n`);
}

async function changedFiles(): Promise<string[]> {
	const paths = new Set<string>();
	for (const entry of await readdir(STATE_DIR, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
		for (const line of (await readFile(`${STATE_DIR}/${entry.name}`, "utf8")).split("\n")) {
			try {
				const change = JSON.parse(line) as Change;
				if (typeof change.path !== "string" || !(await stat(change.path)).isFile()) continue;
				paths.add(change.path);
			} catch {
				// Ignore incomplete concurrent writes and paths removed after recording.
			}
		}
	}
	return [...paths];
}

function displayPath(path: string, cwd: string): string {
	const repo = resolve(cwd);
	const home = resolve(Bun.env.HOME ?? "~");
	if (path === repo || path.startsWith(`${repo}/`)) return `.${path.slice(repo.length)}`;
	if (path === home || path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
	return path;
}

export default function filesExtension(pi: ExtensionAPI): void {
	const pending = new Map<string, string>();

	pi.on("session_start", async () => {
		await mkdir(STATE_DIR, { recursive: true });
	});

	pi.on("tool_call", event => {
		if (event.toolName !== "edit" && event.toolName !== "write") return;
		const path = inputPath(event.input);
		if (path) pending.set(event.toolCallId, path);
	});

	pi.on("tool_execution_end", async event => {
		const path = pending.get(event.toolCallId);
		if (!path || event.isError) return;
		pending.delete(event.toolCallId);
		await record(path);
	});

	pi.registerCommand("files", {
		description: "Fuzzy-select a file changed by OMP agents and open it in Neovim",
		handler: async (_args, ctx) => {
		if (!ctx.hasUI) return;
		const files = await changedFiles();
		if (files.length === 0) {
			ctx.ui.notify("No files have been created or modified by OMP agents.", "info");
			return;
		}

		const byDisplayPath = new Map(files.map(path => [displayPath(path, ctx.cwd), path]));
		const selected = await ctx.ui.select(
			"Files changed by OMP agents",
			[...byDisplayPath.keys()].sort().map(label => ({ label })),
		);
		const path = selected ? byDisplayPath.get(selected) : undefined;
		if (!path) return;

		const result = await pi.exec(
			"kitty",
			["@", "launch", "--type=overlay", "--wait-for-child-to-exit", "--cwd", ctx.cwd, "nvim", "--", path],
			{ cwd: ctx.cwd },
		);
		if (result.code !== 0) ctx.ui.notify(`Neovim did not start: ${result.stderr || result.stdout}`, "error");
	},
	});
}
