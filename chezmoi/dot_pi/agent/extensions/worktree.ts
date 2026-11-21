/**
 * `/worktree`: the `agent-worktree` CLI from inside Pi, no model involved.
 *
 * - `/worktree <name> [--base <ref>] [--path <dir>]` creates a ready worktree (branch, overlay venv, JS packages)
 * - `/worktree remove <name|path> [--force] [--delete-branch]`, `/worktree list`
 * - The session stays in its directory: start Pi in the printed path to work there
 * - Names from an issue number are the `worktree` skill's job (`/skill:worktree`), it calls the same CLI
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SUBCOMMANDS = ["create", "remove", "list"];

export default function worktreeExtension(pi: ExtensionAPI): void {
	pi.registerCommand("worktree", {
		description: "Create, remove or list git worktrees (agent-worktree)",
		getArgumentCompletions: (prefix) =>
			prefix.includes(" ") ? null : SUBCOMMANDS.filter((name) => name.startsWith(prefix)).map((name) => ({ value: name, label: name })),
		handler: async (args, ctx) => {
			const words = args.trim().split(/\s+/).filter(Boolean);
			if (words.length === 0) words.push("list");
			if (!SUBCOMMANDS.includes(words[0])) words.unshift("create");
			const result = await pi.exec("agent-worktree", words, { cwd: ctx.cwd });
			const output = (result.code === 0 ? result.stdout : result.stderr || result.stdout).trim();
			ctx.ui.notify(output || `agent-worktree exited ${result.code}`, result.code === 0 ? "info" : "error");
		},
	});
}
