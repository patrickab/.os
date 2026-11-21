/**
 * The bash tool row: what the call is for, the command in one line, the end of its output.
 *
 * - Consumes a Pi tool row (args, result, expanded) and omp's card primitives
 * - Collapsed: the model's `description` as the card's head, the command cut to one line, the last output lines
 * - Expanded (click or `Ctrl+O`): the whole command, highlighted, and the whole output
 */
import { framedToolCard, type ToolCardSection } from "@oh-my-pi/pi-tui/render/tool-card";
import { sanitizeDisplayLines } from "@oh-my-pi/pi-tui/render/render-utils";
import type { theme as ompTheme } from "@oh-my-pi/pi-tui/theme";
import { formatBashCommandLines } from "@oh-my-pi/pi-tui/tools/bash";
import { truncateToWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-tui/utils";

/** Output lines a collapsed card shows, the end of the output: a command's verdict is in its last lines. */
const COLLAPSED_OUTPUT_LINES = 8;
const FALLBACK_TITLE = "Bash";

type Theme = typeof ompTheme;

export interface BashRow {
	args: Record<string, unknown>;
	result?: {
		content: Array<{ type: string; text?: string }>;
		details?: Record<string, unknown>;
		isError?: boolean;
		durationMs?: number;
	};
	expanded: boolean;
	isPartial: boolean;
}

/** The parameter the bash tool gains, see `describedBashTool` in index.ts. */
export const BASH_DESCRIPTION_GUIDE =
	"What this command is for, shown to the user as the title of the call: 3 to 8 words starting with an imperative verb " +
	'(Investigate, Test, Debug, Build, Measure, Fix...), e.g. "Investigate failing notebook styles". No trailing period.';

function title(args: Record<string, unknown>): string {
	const description = typeof args.description === "string" ? args.description.replace(/\s+/g, " ").trim() : "";
	return description || FALLBACK_TITLE;
}

function commandLines(row: BashRow, theme: Theme, width: number): string[] {
	const command = typeof row.args.command === "string" ? row.args.command : "";
	if (row.expanded) return formatBashCommandLines({ command }, theme).flatMap((line) => wrapTextWithAnsi(line, width));
	const oneLine = command.replace(/\s+/g, " ").trim();
	return [truncateToWidth(`${theme.fg("dim", "$")} ${theme.fg("muted", oneLine)}`, width)];
}

function outputLines(row: BashRow, theme: Theme, width: number): string[] {
	const text = (row.result?.content ?? [])
		.map((part) => (part.type === "text" ? (part.text ?? "") : ""))
		.join("")
		.replace(/\s+$/, "");
	if (!text) return [];
	const lines = sanitizeDisplayLines(text);
	if (row.expanded) return lines.flatMap((line) => wrapTextWithAnsi(line, width));
	const shown = lines.slice(-COLLAPSED_OUTPUT_LINES).map((line) => truncateToWidth(line, width));
	const hidden = lines.length - shown.length;
	return hidden > 0 ? [theme.fg("dim", `… ${hidden} earlier ${hidden === 1 ? "line" : "lines"}`), ...shown] : shown;
}

/** Duration and a failing exit code, the facts of a finished call. */
function facts(row: BashRow): string[] {
	const result = row.result;
	if (!result || row.isPartial) return [];
	const parts: string[] = [];
	const exitCode = result.details?.exitCode;
	if (typeof exitCode === "number" && exitCode !== 0) parts.push(`exit ${exitCode}`);
	if (typeof result.durationMs === "number" && result.durationMs >= 1000) parts.push(`${(result.durationMs / 1000).toFixed(1)}s`);
	return parts;
}

export function renderBashCard(row: BashRow, theme: Theme, width: number): string[] {
	const running = !row.result || row.isPartial;
	const failed = !running && row.result?.isError === true;
	const card = framedToolCard(theme, ({ contentWidth }) => {
		const sections: ToolCardSection[] = [{ content: commandLines(row, theme, contentWidth) }];
		const output = outputLines(row, theme, contentWidth);
		if (output.length > 0) sections.push({ content: output, separator: true });
		return {
			status: {
				icon: running ? "pending" : failed ? "error" : undefined,
				iconOverride: running || failed ? undefined : theme.styledSymbol("tool.bash", "accent"),
				title: title(row.args),
				meta: facts(row),
			},
			phase: running ? "pending" : failed ? "error" : "success",
			sections,
		};
	});
	return [...card.render(width)];
}
