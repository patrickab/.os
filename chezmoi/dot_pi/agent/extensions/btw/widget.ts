/**
 * The TUI widget: renders the newest btw thread of a `BtwState` above the editor. It holds no state of its own and
 * decides nothing; a close click calls `onClose`, which `index.ts` maps to the same action as Esc (`escapeCall`).
 *
 * - The body (question, answer, follow-ups) shows its last `MAX_BODY_LINES` lines, so a streaming answer scrolls
 * - In fullscreen mode a left click on the header's `[x]` closes the thread (regular mode has no mouse input)
 */
import type { MarkdownTheme } from "@earendil-works/pi-tui";
import { Markdown, truncateToWidth, visibleWidth, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { BtwState, BtwStatus, BtwThread } from "./core.ts";

export const MAX_BODY_LINES = 16;
const CLOSE_LABEL = "[x]";

/** The subset of Pi's `Theme` the widget uses. */
export interface WidgetTheme {
  fg(color: "accent" | "dim" | "muted" | "error" | "warning" | "success", text: string): string;
  bold(text: string): string;
}

const STATUS_COLOR: Record<BtwStatus, "accent" | "success" | "error" | "warning"> = {
  streaming: "accent",
  done: "success",
  error: "error",
  cancelled: "warning",
};

export class BtwWidget implements Component {
  private cache: { width: number; state: BtwState; lines: string[] } | undefined;

  constructor(
    private readonly state: () => BtwState,
    private readonly theme: WidgetTheme,
    private readonly markdownTheme: MarkdownTheme,
    private readonly onClose: () => void,
  ) {}

  invalidate(): void {
    this.cache = undefined;
  }

  render(width: number): string[] {
    const state = this.state();
    if (this.cache && this.cache.width === width && JSON.stringify(this.cache.state) === JSON.stringify(state)) return this.cache.lines;
    const thread = state.threads.at(-1);
    const lines = thread ? this.renderThread(thread, state.threads.length - 1, width) : [];
    this.cache = { width, state, lines };
    return lines;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "click" || event.button !== "left" || event.y !== 0) return undefined;
    if (event.x < event.width - CLOSE_LABEL.length) return undefined;
    this.onClose();
    return { handled: true };
  }

  private renderThread(thread: BtwThread, older: number, width: number): string[] {
    const { theme } = this;
    const status = theme.fg(STATUS_COLOR[thread.status], thread.status);
    const title = `${theme.fg("accent", theme.bold("btw"))} ${theme.fg("dim", thread.id)} ${status}`;
    const header = truncateToWidth(title, Math.max(0, width - CLOSE_LABEL.length - 1));
    const gap = Math.max(1, width - visibleWidth(header) - CLOSE_LABEL.length);
    const lines = [truncateToWidth(`${header}${" ".repeat(gap)}${theme.fg("dim", CLOSE_LABEL)}`, width)];

    const body: string[] = [];
    const exchanges = [thread, ...thread.followUps];
    for (const exchange of exchanges) {
      body.push(truncateToWidth(theme.fg("muted", `> ${exchange.question}`), width));
      if (exchange.answer) body.push(...new Markdown(exchange.answer, 0, 0, this.markdownTheme).render(width));
      else if (exchange.status === "streaming") body.push(theme.fg("dim", "…"));
      if (exchange.error) body.push(truncateToWidth(theme.fg("error", `error: ${exchange.error}`), width));
    }
    if (body.length > MAX_BODY_LINES) {
      const hidden = body.length - MAX_BODY_LINES + 1;
      lines.push(theme.fg("dim", `… ${hidden} line${hidden > 1 ? "s" : ""} above`), ...body.slice(-(MAX_BODY_LINES - 1)));
    } else {
      lines.push(...body);
    }

    const hints =
      thread.status === "streaming"
        ? ["Esc cancel", "/btw-cancel"]
        : ["Esc close", "/btw-followup <question>", "/btw-dismiss"];
    if (older > 0) hints.push(`${older} older: /btw-list`);
    lines.push(truncateToWidth(theme.fg("dim", hints.join(" · ")), width));
    return lines;
  }
}
