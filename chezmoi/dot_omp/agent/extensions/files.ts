import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { appendFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const STATE_DIR = `${Bun.env.PI_CODING_AGENT_DIR ?? `${Bun.env.HOME}/.omp/agent`}/extensions/files`;
const STATE_FILE = `${STATE_DIR}/${process.pid}.jsonl`;

type Change = { path: string; sessionFile: string };

function inputPath(input: Record<string, unknown>): string | undefined {
	return typeof input.path === "string" ? input.path : undefined;
}

async function record(path: string, sessionFile: string | undefined): Promise<void> {
	if (!sessionFile) return;
	await appendFile(STATE_FILE, `${JSON.stringify({ path: resolve(path), sessionFile } satisfies Change)}\n`);
}

async function sessionArtifacts(sessionFile: string): Promise<string[]> {
	const artifacts = [sessionFile];
	const artifactDir = sessionFile.replace(/\.jsonl$/, "");
	try {
		for await (const path of new Bun.Glob("**/*.jsonl").scan({ cwd: artifactDir, onlyFiles: true })) {
			artifacts.push(join(artifactDir, path));
		}
	} catch {
		// A session without subagents has no artifact directory.
	}
	return artifacts;
}

async function changedFiles(sessionFiles: readonly string[]): Promise<string[]> {
	const sessionFileSet = new Set(sessionFiles);
	const paths = new Set<string>();
	for (const entry of await readdir(STATE_DIR, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
		for (const line of (await readFile(join(STATE_DIR, entry.name), "utf8")).split("\n")) {
			try {
				const change = JSON.parse(line) as Change;
				if (typeof change.path !== "string" || !sessionFileSet.has(change.sessionFile) || !(await stat(change.path)).isFile()) continue;
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

	pi.on("tool_execution_end", async (event, ctx) => {
		const path = pending.get(event.toolCallId);
		if (!path || event.isError) return;
		pending.delete(event.toolCallId);
		await record(path, ctx.sessionManager.getSessionFile());
	});

	pi.registerCommand("files", {
		description: "Fuzzy-select a file changed by this OMP session or one of its subagents",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			const sessionFile = ctx.sessionManager.getSessionFile();
			if (!sessionFile) {
				ctx.ui.notify("This ephemeral session has no agent session artifact.", "info");
				return;
			}

			const artifacts = await sessionArtifacts(sessionFile);
			const files = await changedFiles(artifacts);
			const choices = [
				...files.map(path => ({ label: displayPath(path, ctx.cwd), path, description: "Modified file" })),
				...artifacts.map(path => ({ label: `[agent session] ${displayPath(path, ctx.cwd)}`, path, description: "Session artifact" })),
			];
			const selected = await ctx.ui.select("Files changed by this session", choices);
			const path = selected ? choices.find(choice => choice.label === selected)?.path : undefined;
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
