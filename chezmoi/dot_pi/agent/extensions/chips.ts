/**
 * Paste chips in the prompt and sent messages ("image #1", "video #2", "text N chars") from pix-pretty, plus video chips.
 *
 * - pix-display would also bring its own thinking blocks, code frames and working timer, so only the chip feature
 *   is loaded. The editor is wrapped after minimal-ui.ts installs its own, hence the delay
 * - Video files (pasted, dropped or typed as an absolute path) become chips like images. The model gets the path
 *   as `<paste>…</paste>`, as for images
 * - The video layer sits inside pix's: its render turns video markers into chips before pix sees them, pix's
 *   paste and insert hooks hand video paths down to it
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";

const PIX = join(homedir(), ".pi/agent/npm/node_modules/@xynogen/pix-pretty/src");
const AFTER_EDITOR_MS = 400;
const VIDEO_GLYPH = "\u{F0567}";
const VIDEO = "mp4|webm|mov|mkv|avi|m4v";
const VIDEO_FILE = new RegExp(`^(?:~|/)[^\\r\\n]+\\.(?:${VIDEO})$`, "i");
const VIDEO_PATH = new RegExp(`(^|[^\\w/@])((?:~|/)[^\\s,;'"(){}[\\]]+\\.(?:${VIDEO}))(?=$|[\\s,;'"(){}[\\]])`, "gi");
const VIDEO_PASTE_TAG = new RegExp(`<paste>((?:~|/)[^<\\r\\n]+\\.(?:${VIDEO}))</paste>`, "gi");
// Zero-width codes the editor may put inside a marker (SGR, cursor marker, fake-cursor APC), as in pix's chips.ts.
const CODE = "(?:\\x1b\\[[0-9;]*m|\\x1b_pi:(?:c|/?fc)\\x07)";
const MARKER = new RegExp(`${CODE}*\\[${CODE}*paste #(?:[^\\]]|${CODE})*\\]`, "g");
const CODES = new RegExp(CODE, "g");

type Video = { kind: "video"; path: string };
type PiEditor = {
	pastes: Map<number, unknown>;
	pasteCounter: number;
	handlePaste(text: string): void;
};

const isVideo = (value: unknown): value is Video => (value as Video | undefined)?.kind === "video";

/** Chip video paths and render video markers; install before pix's `installChips` so pix wraps this layer. */
function installVideoChips(editor: CustomEditor, ansi: Record<string, string>): void {
	// SAFETY: Pi's TS-private members remain runtime properties on CustomEditor.
	const pi = editor as unknown as PiEditor;
	const label = (id: number) => `${ansi.FG_BLUE}${ansi.BOLD}${VIDEO_GLYPH} video${ansi.RST}${ansi.FG_DIM} #${id}${ansi.RST}`;

	const handlePaste = pi.handlePaste.bind(editor);
	pi.handlePaste = (text) => (VIDEO_FILE.test(text.trim()) ? editor.insertTextAtCursor(text.trim()) : handlePaste(text));

	const insertTextAtCursor = editor.insertTextAtCursor.bind(editor);
	editor.insertTextAtCursor = (text: string) => {
		const chip = (path: string) => {
			const id = ++pi.pasteCounter;
			pi.pastes.set(id, { kind: "video", path } satisfies Video);
			return `[paste #${id} ${path.length} chars]`;
		};
		const replaced = VIDEO_FILE.test(text.trim())
			? `${chip(text.trim())} `
			: text.replace(VIDEO_PATH, (_match, prefix: string, path: string) => prefix + chip(path));
		insertTextAtCursor(replaced);
	};

	const render = editor.render.bind(editor);
	editor.render = (width: number) =>
		render(width).map((line) =>
			line.replace(MARKER, (span) => {
				const id = Number(/\[paste #(\d+)/.exec(span.replace(CODES, ""))?.[1]);
				if (!isVideo(pi.pastes.get(id))) return span;
				// Keep the cursor a chip swallowed, drawn inverse as pix does.
				const cursor = span.includes(CURSOR_MARKER) ? CURSOR_MARKER : "";
				const inverse = span.includes("\x1b[7m") || span.includes("\x1b_pi:fc\x07");
				return inverse ? `${cursor}\x1b[7m${label(id).replaceAll(ansi.RST, `${ansi.RST}\x1b[7m`)}\x1b[27m` : cursor + label(id);
			}),
		);
}

export default async function (pi: ExtensionAPI) {
	const [{ installChips, renderHistoryChips }, ansi] = await Promise.all([import(`${PIX}/chips.ts`), import(`${PIX}/ansi.ts`)]);

	pi.registerMarkdownTransformer?.(
		(markdown, { messageType }) =>
			messageType === "user"
				? renderHistoryChips(markdown.replace(VIDEO_PASTE_TAG, (_match, path: string) => `\`${VIDEO_GLYPH} video · ${path.split("/").pop()}\``))
				: markdown,
		{ messageTypes: ["user"] },
	);

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		setTimeout(() => {
			const previous = ctx.ui.getEditorComponent();
			ctx.ui.setEditorComponent((tui, theme, keybindings) => {
				const editor = previous?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
				// A foreign editor lacks the internals chips patch, it stays unchipped.
				if (editor instanceof CustomEditor) {
					installVideoChips(editor, ansi);
					installChips(editor);
				}
				return editor;
			});
		}, AFTER_EDITOR_MS);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode === "tui") ctx.ui.setEditorComponent(undefined);
	});
}
