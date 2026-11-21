/**
 * omp's look inside Pi: answers through omp's Markdown, built-in tool rows as omp tool cards.
 *
 * - Consumes `@oh-my-pi/pi-tui` (pinned in package.json) and the omp theme in `~/.omp/agent/themes`
 * - Display only: messages, session files and model context keep their original content
 * - Pi's `Ctrl+O` drives the cards: collapsed shows what ran (header, summary footer), expanded everything
 * - Failed calls keep omp's output preview while collapsed; any render error falls back to Pi's own row
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AssistantMessageComponent, type ExtensionAPI, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Markdown as PiMarkdown } from "@earendil-works/pi-tui";
import { Markdown as OmpMarkdown } from "@oh-my-pi/pi-tui/components/markdown";
import { getMarkdownTheme, setThemeInstance, theme } from "@oh-my-pi/pi-tui/theme";
import { createTheme } from "@oh-my-pi/pi-tui/theme/loader";
import { bashToolRenderer } from "@oh-my-pi/pi-tui/tools/bash";
import { editToolRenderer } from "@oh-my-pi/pi-tui/tools/edit";
import { globToolRenderer } from "@oh-my-pi/pi-tui/tools/glob";
import { grepToolRenderer } from "@oh-my-pi/pi-tui/tools/grep";
import { readToolRenderer } from "@oh-my-pi/pi-tui/tools/read";
import { writeToolRenderer } from "@oh-my-pi/pi-tui/tools/write";

const OMP_THEME_PATH = join(homedir(), ".omp/agent/themes/oh-lucy-evening-custom.json");
const HASHLINE_PATH_HEADER = /^\[([^\]#\n]+)#[0-9A-Fa-f]{4}\]/m;
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

interface Rendered {
	render(width: number): readonly string[];
}

interface OmpToolRenderer {
	renderCall(args: never, options: object, uiTheme: typeof theme): Rendered;
	renderResult(result: never, options: object, uiTheme: typeof theme, args: never): Rendered;
}

/** omp renderer per Pi tool name, other tools keep Pi's row. Pi's `find` is omp's `glob`. */
// The renderers take each tool's own argument and details types, unified here for lookup.
const OMP_TOOL_RENDERERS = {
	bash: bashToolRenderer,
	read: readToolRenderer,
	grep: grepToolRenderer,
	find: globToolRenderer,
	write: writeToolRenderer,
	hashline_edit: editToolRenderer,
} as unknown as Record<string, OmpToolRenderer>;

/** Fields of Pi's ToolExecutionComponent this extension reads. */
interface PiToolRow {
	toolName: string;
	args: Record<string, unknown>;
	result?: PiToolResult;
	expanded: boolean;
	isPartial: boolean;
}

interface PiToolResult {
	content: Array<{ type: string; text?: string }>;
	details?: Record<string, unknown>;
	isError?: boolean;
	durationMs?: number;
}

/** Fields of Pi's AssistantMessageComponent and its Markdown children this extension reads. */
interface PiAssistantMessage {
	contentContainer?: { children?: unknown[] };
}

interface PiMarkdownFields {
	text?: unknown;
	paddingX?: number;
}

/** Pi keeps duration on the result and timeout in the args, omp reads both from `details`. */
function toOmpResult(result: PiToolResult, args: Record<string, unknown>): PiToolResult {
	const timeoutSeconds = typeof args.timeout === "number" ? args.timeout : undefined;
	return { ...result, details: { ...result.details, wallTimeMs: result.durationMs, timeoutSeconds } };
}

/** hashline_edit names its file in the `[PATH#TAG]` header of `input`, omp's edit card reads `path`. */
function toOmpArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
	if (toolName !== "hashline_edit" || typeof args.input !== "string") return args;
	const path = HASHLINE_PATH_HEADER.exec(args.input)?.[1];
	return path ? { ...args, path } : args;
}

function renderOmpCard(row: PiToolRow, renderer: OmpToolRenderer, width: number): string[] {
	const options = { expanded: row.expanded, isPartial: row.isPartial, argsComplete: true, executionStarted: true };
	const args = toOmpArgs(row.toolName, row.args) as never;
	if (!row.result) return ["", ...renderer.renderCall(args, options, theme).render(width)];
	const lines = renderer.renderResult(toOmpResult(row.result, row.args) as never, options, theme, args).render(width);
	const isCompact = !row.expanded && !row.isPartial && !row.result.isError;
	return ["", ...(isCompact ? cardHeaderAndFooter(lines) : lines)];
}

/** Keep a card's head (everything above its first `├` section divider) and its bottom border line. */
function cardHeaderAndFooter(lines: readonly string[]): string[] {
	const firstBody = lines.findIndex((line, index) => index > 0 && line.replace(ANSI_PATTERN, "").startsWith("├"));
	const headEnd = firstBody === -1 ? 1 : firstBody;
	return [...lines.slice(0, headEnd), lines[lines.length - 1]];
}

function patchAnswers(): void {
	const prototype: { updateContent(message: unknown, isStreaming?: boolean): void } = AssistantMessageComponent.prototype;
	const originalUpdateContent = prototype.updateContent;
	prototype.updateContent = function updateContent(this: PiAssistantMessage, message, isStreaming) {
		originalUpdateContent.call(this, message, isStreaming);
		const children = this.contentContainer?.children;
		if (!Array.isArray(children)) return;
		for (let index = 0; index < children.length; index++) {
			const child: PiMarkdownFields = children[index] as PiMarkdownFields;
			if (!(children[index] instanceof PiMarkdown) || typeof child.text !== "string") continue;
			children[index] = new OmpMarkdown(child.text, child.paddingX ?? 1, 0, getMarkdownTheme());
		}
	};
}

function patchToolRows(): void {
	const prototype: { render(width: number): string[] } = ToolExecutionComponent.prototype;
	const originalRender = prototype.render;
	prototype.render = function render(this: PiToolRow, width: number): string[] {
		const renderer = OMP_TOOL_RENDERERS[this.toolName];
		if (!renderer) return originalRender.call(this, width);
		try {
			return renderOmpCard(this, renderer, width);
		} catch {
			return originalRender.call(this, width);
		}
	};
}

export default function ompUi(_pi: ExtensionAPI): void {
	setThemeInstance(createTheme(JSON.parse(readFileSync(OMP_THEME_PATH, "utf8"))));
	patchAnswers();
	patchToolRows();
}
