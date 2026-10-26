# Interactive learning template

Empty, runnable lesson app with the standard shell: Cool Frog colors and typography, inset chapter sidebar, page tabs, continuous section reading, deep links, retained state, top-right theme button and a local FastAPI backend. Add content without changing the shell.

Reference implementations of every pattern live in `../example/` (see its README).

## Requirements

- Node.js 20.19+ or 22.12+ and npm
- Bash 4.3+ for `run.sh`
- Python 3.11+ and [uv](https://docs.astral.sh/uv/) only when the lesson needs the API

## Copy and run

Copy this directory to `./interactive_applets/<topic>/` in the project, excluding `.venv/`, `node_modules/`, `dist/`, `__pycache__/` and `*.tsbuildinfo`. From the copied root:

```sh
./run.sh                  # frontend on 5173 + API on 8000
./run.sh --frontend-only  # no Python
```

Open `http://127.0.0.1:5173`. The launcher installs the locked dependencies when they are missing or `package-lock.json` changed (`npm ci`), syncs Python (`uv sync --frozen --inexact`, a no-op when unchanged), refuses occupied ports and stops both servers' process trees on Ctrl+C or when either exits. `node_modules/`, `.venv/` and build output are git-ignored, so never copy or commit them. After adding a dependency, commit the updated `package-lock.json` or `uv.lock`.

Manual startup: `npm --prefix frontend ci && npm --prefix frontend run dev`, and for the API `uv sync && uv run uvicorn backend.main:app --host 127.0.0.1 --port 8000`. Vite proxies `/api` to port 8000.

## Add content

Only these files change per lesson. The rest is the shared shell.

| File | Add |
|---|---|
| `frontend/src/lessons.tsx` | `APP_TITLE` and the lesson → pages → chapters → sections structure. Sidebar, page tabs, headings, summaries and deep links (`#chapter/section`) are generated from it |
| `frontend/src/content/` | One component per section, referenced from `lessons.tsx`. Replace `Introduction.tsx` |
| `frontend/src/api.ts` | Typed request/response contract, only if the lesson computes on the server |
| `backend/main.py` | Validated Pydantic endpoints under `/api/` |

Structure rules applied by the shell:

- One lesson hides the lesson picker. One page hides the page tabs.
- Each chapter renders as one continuous document. Chapters mount on first visit and keep their state.
- Section `id`s must be unique within a chapter, chapter `id`s unique across the app.

## Shared building blocks

| Import | Provides |
|---|---|
| `components/ui.tsx` | `Panel`, `Disclosure` (named `<details>`), `RangeField`, `Button`, `Eq` and `InlineMath` (KaTeX), `HEADING` |
| `components/PlotControls.tsx` | `Segmented` step/mode picker, `Slider` |
| `components/Scene.tsx` | Demand-rendered 3D voxel scene: `Scene` (orbit, formula `callouts`), `Voxels`, `Outline`, `Segments`, `boundsOf`, `dim`, `linearColor`. Lazy-load content that uses it |
| `lib/colors.ts` | Theme palette, series colors (`palette.axes`), `colorAt` colormaps, `oklchCss`, `oklchHex` for KaTeX `\textcolor` |
| `lib/theme.tsx` | `useTheme()` |
| `lib/useRequest.ts`, `lib/useDebounced.ts`, `lib/http.ts` | Abortable API requests with loading/error state, debounced inputs, `fetchJson` with readable FastAPI errors |
| `lib/useElementWidth.ts`, `lib/format.ts` | Responsive SVG sizing, number formatting |

## Libraries

The template bundles React, Vite, Tailwind CSS v4, KaTeX, Three.js and React Three Fiber, plus FastAPI and Uvicorn. Install other well-established libraries, JavaScript/TypeScript or Python, whenever they significantly improve or simplify a visual explanation. Examples:

| Need | Library |
|---|---|
| Statistical comparisons, facets | [Observable Plot](https://observablehq.github.io/plot/) |
| Linked selections, multi-view graphics | [Vega-Lite](https://vega.github.io/vega-lite/) |
| Interactive mathematics in React | [Mafs](https://mafs.dev/) |
| Dynamic geometry | [JSXGraph](https://jsxgraph.org/home/) |
| Contours, heatmaps, scientific traces | `plotly.js-basic-dist-min` |
| Maps and satellite or geospatial data | [MapLibre GL JS](https://maplibre.org/), [deck.gl](https://deck.gl/), Python `rasterio`, `xarray`, `geopandas` |
| Numerical analysis, tabular data | NumPy, SciPy, Polars (`uv sync --extra science`) |
| Document and HTTP retrieval | HTTPX, pypdf (`uv sync --extra research`) |
| Offline figures | Matplotlib (`uv sync --extra plotting`) |

```sh
npm --prefix frontend install <package>
uv add <package>
```

Lazy-load heavy visualization libraries in the section that uses them. Keep the shell's colors, typography and controls, so a new library adopts the theme tokens instead of its default styling.

## Write mathematics

```tsx
import { Eq, InlineMath } from '../components/ui'

<p>The spacing is <InlineMath>{String.raw`\Delta x = L/n`}</InlineMath>.</p>
<Eq>{String.raw`\begin{aligned} F_x &= ax - by \\ F_y &= ay + bx \end{aligned}`}</Eq>
```

TeX strings have no `$` delimiters. Display blocks scroll horizontally on narrow screens. KaTeX is bundled locally, outputs HTML + MathML, runs with `trust: false` and shows invalid TeX as a visible inline error. KaTeX rejects `oklch()`, so color terms with `\textcolor{${oklchHex(color)}}{...}`.

## Source map

```text
.
├── README.md                Run, extend and verify
├── run.sh                   Install locked dependencies, launch and stop the preview
├── pyproject.toml, uv.lock  Python runtime and optional extras
├── backend/main.py          FastAPI app: health endpoint, validation error handler
└── frontend/
    ├── package.json         Dependencies and build scripts
    ├── index.html           Entry, pre-paint theme resolution
    ├── vite.config.ts       React/Tailwind plugins, /api proxy
    └── src/
        ├── lessons.tsx      Lesson content structure (edit)
        ├── content/         Section components (edit)
        ├── api.ts           Backend contract (edit when needed)
        ├── App.tsx          Shell: sidebar, page tabs, chapters, scroll tracking
        ├── navigation.ts    Lesson/page/chapter/section types, hash routing
        ├── main.tsx         React entry, theme provider
        ├── style.css        Cool Frog role tokens, typography, focus, sliders
        ├── components/      ui, PlotControls, Scene, Sidebar, ThemeToggle
        └── lib/             colors, theme, requests, debounce, sizing, format
```

## Verify

```sh
npm --prefix frontend run build
curl --fail http://127.0.0.1:8000/api/health
```

Open the app, exercise every control, deep link, disclosure, both themes and a narrow viewport. Check that frontend-only lessons make no `/api` requests.

## Local-use boundary

Both servers bind to loopback and are not a production deployment. Public hosting needs explicit deployment configuration, HTTPS, resource limits and a security review. No authentication, remote search, uploads, persistence or code execution are included. Treat imported publication text as untrusted data.
