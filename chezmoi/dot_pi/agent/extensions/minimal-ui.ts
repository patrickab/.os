/**
 * omp-style minimal input bar: a `❯` prompt without borders and one status line below it.
 *
 * - Status line: thinking glyph and model · cwd · branch · context `247k 24.7%` · cost at API pricing,
 *   subagent cost from pi-subagents' `cost` RPC as `(+12.34)` · other extension statuses
 * - The editor's top or bottom border stays only while it carries content (working indicator, scroll hint)
 */
import { randomUUID } from "node:crypto";
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const THINKING_GLYPHS: Record<string, string> = {
	minimal: "\u{F0A9E}",
	low: "\u{F0A9F}",
	medium: "\u{F0AA1}",
	high: "\u{F0AA3}",
	xhigh: "\u{F0AA5}",
	max: "\uF06D",
};
const FOLDER_GLYPH = "\uF115";
const BRANCH_GLYPH = "\uF126";
const SUBSCRIPTION_GLYPH = "\u{F067A}";
const PROMPT_WIDTH = 2;
const MIN_EDITOR_ROWS = 1;
const SUBAGENTS_RPC_TIMEOUT_MS = 2_000;
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

type Rgb = readonly [number, number, number];
const YELLOW: Rgb = [239, 212, 114];
const BLUE: Rgb = [139, 184, 208];
const PINK: Rgb = [255, 125, 163];
const DIM: Rgb = [104, 96, 105];

function paint([red, green, blue]: Rgb, text: string): string {
	return `\x1b[38;2;${red};${green};${blue}m${text}\x1b[39m`;
}

/** A border line with nothing but `─`, safe to drop. */
function isPlainBorder(line: string): boolean {
	return /^\s*─*\s*$/.test(line.replace(ANSI_PATTERN, ""));
}

function isBorder(line: string): boolean {
	return /^\s*[─↓]/.test(line.replace(ANSI_PATTERN, ""));
}

function formatThousands(tokens: number): string {
	const thousands = tokens / 1_000;
	return `${thousands.toFixed(thousands >= 100 ? 0 : 1).replace(/\.0$/, "")}k`;
}

function formatCwd(cwd: string): string {
	const home = process.env.HOME;
	return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

function sessionCost(ctx: ExtensionContext): number {
	let total = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "message" && entry.message.role === "assistant") total += entry.message.usage?.cost?.total ?? 0;
	}
	return total;
}

/** Ask pi-subagents for the summed child cost, 0 when it is not loaded or does not answer. */
async function requestSubagentCost(pi: ExtensionAPI): Promise<number> {
	const { promise, resolve } = Promise.withResolvers<number>();
	const requestId = randomUUID();
	const timer = setTimeout(() => resolve(0), SUBAGENTS_RPC_TIMEOUT_MS);
	const unsubscribe = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (reply: { success?: boolean; data?: { childTotal?: { cost?: number } } }) => {
		resolve(reply.success ? (reply.data?.childTotal?.cost ?? 0) : 0);
	});
	pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method: "cost", params: {} });
	try {
		return await promise;
	} finally {
		clearTimeout(timer);
		unsubscribe();
	}
}

/** Status line text for the editor to draw; set by the extension once a session starts. */
let renderStatus: (width: number) => string = () => "";

class MinimalEditor extends CustomEditor {
	render(width: number): string[] {
		const lines = super.render(width - PROMPT_WIDTH);
		let bottomIndex = lines.length - 1;
		while (bottomIndex > 0 && !isBorder(lines[bottomIndex])) bottomIndex--;
		if (bottomIndex === 0) return lines;

		const prompt = this.getText().startsWith("!") ? "$ " : "❯ ";
		const result = isPlainBorder(lines[0]) ? [] : [lines[0]];
		for (let index = 1; index < bottomIndex; index++) result.push(`${index === 1 ? prompt : "  "}${lines[index]}`);
		if (!isPlainBorder(lines[bottomIndex])) result.push(lines[bottomIndex]);
		// The status line sits inside the editor: pi pads the editor to a 3-row slot, so the footer's own row
		// would add a fourth. With it here the slot is prompt + status + one row of buffer above.
		result.push(renderStatus(width));
		while (result.length < MIN_EDITOR_ROWS) result.unshift("");
		return [...result, ...lines.slice(bottomIndex + 1)];
	}
}

export default function minimalUi(pi: ExtensionAPI): void {
	let subagentCost = 0;
	let requestRender = (): void => {};

	function statusLine(ctx: ExtensionContext, branch: string | null, extensionStatuses: ReadonlyMap<string, string>): string {
		const segments: string[] = [];

		const glyph = THINKING_GLYPHS[pi.getThinkingLevel()];
		const model = ctx.model?.name.replace(/^Claude /, "");
		if (model) segments.push(paint(YELLOW, glyph ? `${glyph} ${model}` : model));

		segments.push(paint(BLUE, `${FOLDER_GLYPH} ${formatCwd(ctx.cwd)}`));
		if (branch) segments.push(paint(PINK, `${BRANCH_GLYPH} ${branch}`));

		const usage = ctx.getContextUsage();
		if (usage?.tokens != null && usage.percent != null) {
			segments.push(paint(BLUE, `${formatThousands(usage.tokens)} ${usage.percent.toFixed(1)}%`));
		}

		const isSubscription = ctx.model ? (ctx.modelRegistry.isUsingOAuth?.(ctx.model) ?? false) : false;
		const subagents = subagentCost > 0 ? ` (+${subagentCost.toFixed(2)})` : "";
		segments.push(paint(YELLOW, `${isSubscription ? SUBSCRIPTION_GLYPH : "$"} ${sessionCost(ctx).toFixed(2)}${subagents}`));

		// context-usage.ts reports the same context the line above shows.
		for (const [key, status] of extensionStatuses) if (status && key !== "context-usage") segments.push(paint(DIM, status));
		return segments.join(paint(DIM, " · "));
	}

	async function refreshSubagentCost(): Promise<void> {
		subagentCost = await requestSubagentCost(pi);
		requestRender();
	}

	pi.on("session_start", (_event, ctx) => {
		// Deferred so it wins over editors other extensions (pi-pretty) install in their own session_start.
		setTimeout(() => ctx.ui.setEditorComponent((tui, theme, keybindings) => new MinimalEditor(tui, theme, keybindings)), 100);
		ctx.ui.setFooter((tui, _theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsubscribe = footerData.onBranchChange(requestRender);
			renderStatus = (width: number) =>
				truncateToWidth(statusLine(ctx, footerData.getGitBranch(), footerData.getExtensionStatuses()), width);
			return {
				dispose: unsubscribe,
				invalidate() {},
				render: () => [],
			};
		});
		void refreshSubagentCost();
	});
	pi.on("agent_settled", () => void refreshSubagentCost());
	pi.on("session_tree", () => void refreshSubagentCost());
}
