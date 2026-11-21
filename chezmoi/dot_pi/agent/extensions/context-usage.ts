/**
 * Footer status `context-usage` with the context window use (`12.3k 4.5%`), TUI only: an RPC client shows its own
 * meter, and a non-empty status keeps an idle pi-host session alive.
 */
import type { ContextUsage, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "context-usage";

function formatThousands(tokens: number): string {
	const thousands = tokens / 1_000;
	return `${thousands.toFixed(thousands >= 100 ? 0 : 1).replace(/\.0$/, "")}k`;
}

/** `12.3k 4.5%`, or nothing while Pi does not know the use (right after a compaction). */
function formatUsage(usage: ContextUsage | undefined): string | undefined {
	if (usage?.tokens == null || usage.percent == null) return undefined;
	return `${formatThousands(usage.tokens)} ${usage.percent.toFixed(1)}%`;
}

function refreshContextStatus(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui") return;
	ctx.ui.setStatus(STATUS_KEY, formatUsage(ctx.getContextUsage()));
}

export default function contextUsageExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => refreshContextStatus(ctx));
	pi.on("session_tree", (_event, ctx) => refreshContextStatus(ctx));
	pi.on("turn_end", (_event, ctx) => refreshContextStatus(ctx));
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode === "tui") ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
