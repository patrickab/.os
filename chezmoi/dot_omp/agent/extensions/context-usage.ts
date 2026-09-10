import type { ContextUsage, ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

function formatThousands(tokens: number): string {
	const thousands = tokens / 1_000;
	return `${thousands.toFixed(thousands >= 100 ? 0 : 1).replace(/\.0$/, "")}k`;
}

function formatUsage(usage: ContextUsage): string {
	return `${formatThousands(usage.tokens)} ${usage.percent.toFixed(1)}%`;
}

function refreshContextStatus(ctx: ExtensionContext): void {
	const usage = ctx.getContextUsage();
	ctx.ui.setStatus("context-usage", usage ? formatUsage(usage) : undefined);
}

export default function contextUsageExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => refreshContextStatus(ctx));
	pi.on("session_switch", (_event, ctx) => refreshContextStatus(ctx));
	pi.on("session_branch", (_event, ctx) => refreshContextStatus(ctx));
	pi.on("context", (_event, ctx) => refreshContextStatus(ctx));
	pi.on("session_shutdown", (_event, ctx) => ctx.ui.setStatus("context-usage", undefined));
}
