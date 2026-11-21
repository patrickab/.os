/**
 * `/models`: pix-models' enhanced picker with a provider pane, under a new name.
 *
 * - pix-models can't take over the built-in `/model` on a compiled pi (it patches pi's JS), so its own
 *   extension is filtered out in settings.json and its picker is loaded from here as `/models`.
 *   The built-in `/model` is hidden from autocomplete.
 * - Provider pane left of the list: "All models", then providers most recently used first (alphabetical
 *   for the rest), then deactivated providers. Space on a provider (ctrl+left, alt+left or ctrl+b to focus the pane,
 *   ctrl+right, alt+right, ctrl+f or enter to return) deactivates it: its models leave "All models" but stay reachable
 *   by selecting the provider.
 * - The selected provider is pinned: it persists across sessions, so the picker keeps showing only that
 *   provider until you pick "All models" again.
 * - State lives in ~/.pi/agent/models-picker.json: { recent, disabled, selected }.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const PACKAGES = join(homedir(), ".pi/agent/npm/node_modules/@xynogen");
const STATE_FILE = join(homedir(), ".pi/agent/models-picker.json");
const PANE_WIDTH = 28;

type Prefs = { recent: string[]; disabled: string[]; selected: string | null };
type Lists = { chat: any[]; classifiers: any[]; images: any[] };
type Row = { provider: string | null; label: string; count: number; active: boolean };

function loadPrefs(): Prefs {
	try {
		const raw = JSON.parse(readFileSync(STATE_FILE, "utf8"));
		return { recent: raw.recent ?? [], disabled: raw.disabled ?? [], selected: raw.selected ?? null };
	} catch {
		return { recent: [], disabled: [], selected: null };
	}
}

function savePrefs(prefs: Prefs): void {
	mkdirSync(dirname(STATE_FILE), { recursive: true });
	writeFileSync(STATE_FILE, JSON.stringify(prefs, null, 2));
}

/** View state, module-level because the base class calls buildData() before subclass fields exist. */
const view: { prefs: Prefs; selected: string | null; raw: () => Lists } = {
	prefs: { recent: [], disabled: [], selected: null },
	selected: null,
	raw: () => ({ chat: [], classifiers: [], images: [] }),
};

function filterLists(lists: Lists): Lists {
	const keep = (model: any) =>
		view.selected ? model.provider === view.selected : !view.prefs.disabled.includes(model.provider);
	return {
		chat: lists.chat.filter(keep),
		classifiers: lists.classifiers.filter(keep),
		images: lists.images.filter(keep),
	};
}

export default async function (pi: ExtensionAPI) {
	const { ModelPickerView, MODEL_REFRESH_TIMEOUT_MS } = await import(`${PACKAGES}/pix-models/src/picker-view.ts`);
	const { nonChatNotice } = await import(`${PACKAGES}/pix-models/src/picker-rows.ts`);
	const { reasoningCatalog, withReasoningLevels } = await import(`${PACKAGES}/pix-models/src/thinking.ts`);
	const { registerProjectPrefs } = await import(`${PACKAGES}/pix-models/src/project-prefs.ts`);
	const { frameLines, modalOverlayOptions } = await import(`${PACKAGES}/pix-pretty/src/modal-frame.ts`);
	const { matchesKey, truncateToWidth, visibleWidth } = await import(`${PACKAGES}/pix-pretty/src/tui.ts`);
	const { ioTimeoutSignal } = await import(`${PACKAGES}/pix-runtime/src/io.ts`);

	class ProviderPickerView extends ModelPickerView {
		private focusProviders = false;
		private cursor = Math.max(0, this.rows().findIndex((row) => row.provider === view.selected));

		/** Provider rows for the current tab: All, active (recent first, then A-Z), then deactivated. */
		private rows(): Row[] {
			const raw = view.raw();
			const models: any[] = (this as any).tab === "classifier" ? raw.classifiers : (this as any).tab === "image" ? raw.images : raw.chat;
			const counts = new Map<string, number>();
			for (const model of models) counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
			const rank = (name: string) => {
				const index = view.prefs.recent.indexOf(name);
				return index < 0 ? Number.MAX_SAFE_INTEGER : index;
			};
			const byRecency = (a: string, b: string) => rank(a) - rank(b) || a.localeCompare(b);
			const names = [...counts.keys()];
			const active = names.filter((n) => !view.prefs.disabled.includes(n)).sort(byRecency);
			const inactive = names.filter((n) => view.prefs.disabled.includes(n)).sort((a, b) => a.localeCompare(b));
			const make = (name: string, isActive: boolean): Row => ({ provider: name, label: name, count: counts.get(name) ?? 0, active: isActive });
			const allCount = active.reduce((sum, n) => sum + (counts.get(n) ?? 0), 0);
			return [
				{ provider: null, label: "All models", count: allCount, active: true },
				...active.map((n) => make(n, true)),
				...inactive.map((n) => make(n, false)),
			];
		}

		private refilter(): void {
			(this as any).showData((this as any).buildData(), (this as any).list.getSelectedItem?.()?.value);
			(this as any).d.tui.requestRender();
		}

		private renderPane(height: number): string[] {
			const { theme } = (this as any).d;
			const rows = this.rows();
			const inner = PANE_WIDTH - 4;
			const capacity = Math.max(1, height - 2 - 2); // borders, hint rows
			this.cursor = Math.min(this.cursor, rows.length - 1);
			const start = Math.max(0, Math.min(this.cursor - Math.floor(capacity / 2), rows.length - capacity));
			const lines: string[] = [];
			let sawInactive = false;
			for (const [index, row] of rows.slice(start, start + capacity).entries()) {
				const absolute = start + index;
				if (!row.active && !sawInactive && absolute > 0) {
					sawInactive = true;
					if (lines.length < capacity - 1) lines.push(theme.fg("muted", "─".repeat(inner)));
				}
				const chosen = row.provider === view.selected;
				const here = this.focusProviders && absolute === this.cursor;
				const dot = row.provider === null ? "◆" : row.active ? "●" : "○";
				const count = String(row.count);
				const name = truncateToWidth(row.label, inner - 4 - count.length, "…");
				const gap = " ".repeat(Math.max(1, inner - 3 - visibleWidth(name) - count.length));
				const text = `${dot} ${name}${gap}${count}`;
				lines.push(
					here
						? theme.fg("accent", theme.bold(`›${text}`))
						: chosen
							? theme.fg("accent", ` ${text}`)
							: row.active
								? theme.fg("text", ` ${text}`)
								: theme.fg("muted", ` ${text}`),
				);
			}
			while (lines.length < height - 2 - 2) lines.push("");
			lines.push("");
			lines.push(theme.fg("muted", this.focusProviders ? "space on/off · ⏎ back" : "ctrl+b providers"));
			return frameLines({
				width: PANE_WIDTH,
				lines,
				title: "Providers",
				color: (s: string) => theme.fg(this.focusProviders ? "accent" : "muted", s),
				titleColor: (s: string) => theme.fg("accent", s),
				bg: (s: string) => theme.bg("customMessageBg", s),
				fg: (s: string) => theme.fg("text", s),
				wrap: false,
			});
		}

		render(width: number): string[] {
			const right: string[] = super.render(Math.max(40, width - PANE_WIDTH - 1));
			const left = this.renderPane(right.length);
			return right.map((line, index) => {
				const pad = Math.max(0, width - PANE_WIDTH - 1 - visibleWidth(line));
				return `${left[index] ?? " ".repeat(PANE_WIDTH)} ${line}${" ".repeat(pad)}`;
			});
		}

		async handleInput(data: string): Promise<void> {
			if (matchesKey(data, "ctrl+left") || matchesKey(data, "alt+left") || matchesKey(data, "ctrl+b")) {
				this.focusProviders = true;
				(this as any).d.tui.requestRender();
				return;
			}
			if (!this.focusProviders) return super.handleInput(data);
			const rows = this.rows();
			const tui = (this as any).d.tui;
			if (matchesKey(data, "escape")) return super.handleInput(data);
			if (matchesKey(data, "ctrl+right") || matchesKey(data, "alt+right") || matchesKey(data, "ctrl+f") || matchesKey(data, "enter") || matchesKey(data, "tab")) {
				this.focusProviders = false;
			} else if (matchesKey(data, "up") || matchesKey(data, "down")) {
				const step = matchesKey(data, "up") ? -1 : 1;
				this.cursor = (this.cursor + step + rows.length) % rows.length;
				view.selected = rows[this.cursor]?.provider ?? null;
				view.prefs.selected = view.selected;
				savePrefs(view.prefs);
				this.refilter();
				return;
			} else if (data === " " || matchesKey(data, "space")) {
				const name = rows[this.cursor]?.provider;
				if (name) {
					const disabled = view.prefs.disabled;
					view.prefs.disabled = disabled.includes(name) ? disabled.filter((n) => n !== name) : [...disabled, name];
					savePrefs(view.prefs);
					this.cursor = Math.max(0, this.rows().findIndex((row) => row.provider === name));
					this.refilter();
					return;
				}
			}
			tui.requestRender();
		}
	}

	function modelSource(ctx: ExtensionContext) {
		const registry = ctx.modelRegistry as any;
		const loadOfType = async (type: "classifier" | "image") => (await registry.getAvailableOfType?.(type).catch(() => [])) ?? [];
		const load = async (): Promise<Lists> => {
			const chat = await registry.getAvailable();
			const [classifiers, images] = await Promise.all([loadOfType("classifier"), loadOfType("image")]);
			return { chat, classifiers, images };
		};
		return { registry, load };
	}

	async function showPicker(ctx: ExtensionContext, initialSearch: string): Promise<void> {
		const { registry, load } = modelSource(ctx);
		let lists = await load();
		if (lists.chat.length === 0) {
			await registry.refresh?.({ signal: ioTimeoutSignal(undefined, MODEL_REFRESH_TIMEOUT_MS) });
			lists = await load();
		}
		if (lists.chat.length === 0) {
			ctx.ui.notify("No models with configured auth.", "warning");
			return;
		}

		view.prefs = loadPrefs();
		view.raw = () => lists;
		view.selected = lists.chat.some((model: any) => model.provider === view.prefs.selected) ? view.prefs.selected : null;
		const catalog = lists.chat.some((model: any) => model.reasoning) ? await reasoningCatalog.get() : [];
		const source = {
			get current() {
				return filterLists(lists);
			},
			set current(next: Lists) {
				lists = next;
			},
			async refresh(force: boolean, signal: AbortSignal, closed: AbortSignal) {
				const outcome = await registry.refresh?.({ force, signal });
				if (closed.aborted) return undefined;
				if (outcome?.aborted) ctx.ui.notify("Model refresh timed out; showing cached models.", "warning");
				else if (outcome?.errors.size) ctx.ui.notify(`Model refresh failed for ${[...outcome.errors.keys()].join(", ")}; showing cached models.`, "warning");
				const next = await load();
				if (closed.aborted) return undefined;
				if (next.chat.length === 0) {
					ctx.ui.notify("No models with configured auth.", "warning");
					return undefined;
				}
				return next;
			},
		};

		const result = await ctx.ui.custom<string | null>(
			(tui: any, theme: any, _kb: any, done: (value: string | null) => void) =>
				new ProviderPickerView({
					pi,
					ctx,
					tui,
					theme,
					source,
					current: ctx.model ? withReasoningLevels(ctx.model, catalog) : undefined,
					initialSearch,
					done,
				}),
			{ overlay: true, overlayOptions: modalOverlayOptions() },
		);
		if (result) await applySelection(ctx, result, lists.chat, catalog);
	}

	async function applySelection(ctx: ExtensionContext, result: string, available: any[], catalog: any): Promise<void> {
		const notice = nonChatNotice(result);
		if (notice) {
			ctx.ui.notify(notice, "info");
			return;
		}
		const [provider, ...rest] = result.split("/");
		const id = rest.join("/");
		const picked = available.find((model) => model.provider === provider && model.id === id);
		if (!picked) {
			ctx.ui.notify(`Model not found: ${result}`, "error");
			return;
		}
		const enriched = withReasoningLevels(picked, catalog);
		if (!(await pi.setModel(enriched))) {
			ctx.ui.notify(`Failed to switch to ${picked.id}`, "error");
			return;
		}
		if (enriched !== picked) ctx.ui.notify(`Thinking options for ${picked.id}: models.dev`, "info");
		const prefs = loadPrefs();
		savePrefs({ ...prefs, recent: [provider, ...prefs.recent.filter((name) => name !== provider)] });
	}

	registerProjectPrefs(pi);
	pi.registerCommand("models", {
		description: "Model picker with providers, benchmark rank, score and cost",
		handler: async (args, ctx) => {
			await showPicker(ctx, typeof args === "string" ? args.trim() : "");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.addAutocompleteProvider((current) => ({
			async getSuggestions(lines, line, col, options) {
				const result = await current.getSuggestions(lines, line, col, options);
				if (!result) return result;
				return { ...result, items: result.items.filter((item) => item.value !== "model") };
			},
			applyCompletion: (lines, line, col, item, prefix) => current.applyCompletion(lines, line, col, item, prefix),
			shouldTriggerFileCompletion: (lines, line, col) => current.shouldTriggerFileCompletion?.(lines, line, col) ?? true,
		}));
	});
}
