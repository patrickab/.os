# Interactive learning examples

Two finished lessons built on the shared shell of `../template/`. Use them as references for structure, explanations, plots and contracts. Start new applications from `../template/`, not from this directory. Shell files (`App.tsx`, `navigation.ts`, `main.tsx`, `style.css`, `components/`, `lib/`) are identical in both apps. Keep them in sync when changing the shell.

| Example | Structure | Runtime |
|---|---|---|
| Scientific model guide | Overview, Inside the model, Learning & evaluation, and Example plots pages, each with chapters and subchapters | Frontend only, no dataset, Python, model weights, or remote services. 3D plots need WebGL2 |
| Field decomposition | Focused lesson with potential, rotation, and total compared side by side | Frontend plus the optional Python API for its numerical experiment |

The guide is conceptual teaching material, not a trained model or a benchmark report. The field example is an analytic illustration, not a general Helmholtz solver. Neither example performs publication search.

## Requirements

- Node.js 20.19+ or 22.12+ and npm
- Bash 4.3+ for `run.sh`
- Network access for the initial JavaScript dependency installation
- Python 3.11+ and [uv](https://docs.astral.sh/uv/) only for the optional field-decomposition API

## Run

From this directory:

```sh
./run.sh
```

Open `http://127.0.0.1:5173`. The default is the scientific model guide at `/#guide-purpose/task`. The sidebar's lesson picker opens the field-decomposition lesson at `/#helmholtz/idea`. `./run.sh --frontend-only` runs only the guide, without Python or uv. Press Ctrl+C to stop both servers.

The guide's four pages use the same shell, with a page-specific chapter outline. Optional detail disclosures and interaction state survive page changes. Its diagrams use deterministic illustrations created in the browser, never downloads or fabricated scientific results.

## Python experiment

Only the field-decomposition experiment needs the API. For manual startup, in a second terminal here:

```sh
uv sync
uv run uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Vite proxies `/api` to `http://127.0.0.1:8000`. The guide makes no API calls.

## Source map

```text
.
├── README.md                  Run, extend, and verify this application
├── run.sh                     Shared launcher: install locked dependencies, launch and stop the preview
├── pyproject.toml             Python runtime and optional scientific extras
├── backend/
│   ├── __init__.py             Python module marker
│   └── main.py                 FastAPI input validation and analytic field calculation
└── frontend/
    ├── package.json           React, Vite, Tailwind, font, and build commands
    ├── index.html             HTML entry point
    ├── vite.config.ts         React/Tailwind plugins and local API proxy
    ├── tsconfig.json          TypeScript build checks
    └── src/
        ├── lessons.tsx        Both lessons: guide pages and chapters, APP_TITLE
        ├── chapters.tsx       Field-decomposition chapters
        ├── api.ts             Typed decomposition request and response contract
        ├── App.tsx, navigation.ts, main.tsx, style.css, components/, lib/   Shared shell, identical to ../template
        └── content/           Teaching sections, SVG experiment, and report guidance
            ├── guide/
            │   ├── Overview.tsx       Task, workflow, appropriate uses, and scope
            │   ├── Architecture.tsx   Representations, mixing, and compression illustrations
            │   └── Learning.tsx       Objectives, split comparison, generalization, and adaptation
            └── plots/
                ├── Examples.tsx       Lazy-loaded plot sections and teaching context
                ├── TensorExample.tsx  Tensor rearrangement: input, crops and batch
                └── MixingExamples.tsx Source-derived convolution and attention on components/Scene.tsx
```

## Scientific contract

`POST /api/decomposition` accepts:

```json
{"potential": 1, "rotation": 1}
```

Both strengths must be finite numbers in `[0, 2]`. Unknown fields and invalid values return HTTP 422. The response contains the strengths, a 9 × 9 grid on `[-1, 1]²`, the two components and their sum at each point, and exact scalar divergence and 2D curl.

For strengths `a` and `b`:

- Potential component: `P(x, y) = (ax, ay)`, the gradient of `a(x² + y²)/2`
- Rotation component: `R(x, y) = (-by, bx)`, with zero divergence
- Total: `F = P + R`, with divergence `2a` and scalar curl `2b`

The coordinates and field values are dimensionless. These components are supplied analytically. The server does not infer them from arbitrary samples. General decompositions require a specified domain, regularity, and boundary or decay conditions, and may include a harmonic contribution. Changing only these strengths is not a general proof or numerical solution of the theorem.

`GET /api/health` returns `{"status":"ok"}`. FastAPI exposes its generated contract at `/docs`. Computation is stateless and local. Browser preferences are stored locally, not on the server. Failed API requests must remain visible rather than being replaced with synthetic success.

## Source provenance

The complex guide links educational foundations and primary scientific sources near the concepts they support. Optional source disclosures record the checked chapter or section, source type, date, and applicability limits. The illustrative curves, split assignments, and grids are constructed in the browser, not experimental results from those publications.

Sources were checked on 2026-10-24. Links are static: opening a reference requires a network connection, but reading and interacting with the guide does not. The guide is not a systematic review or a live source-search service.

### Adapted Cool Frog figures

These references are adapted from `~/git/cool-frog/frontend/src/`, not its datasets, weights or API clients. The 3D scenes use bundled `three` and `@react-three/fiber`, lazy-loaded when visiting a plot chapter. The smaller SVG and canvas figures need no additional visualization library.

| Example | Open in the guide | Local implementation | Source |
|---|---|---|---|
| Slice a synthetic Gaussian volume | `/#guide-representation/representation`, expand “What does a 3D grid look like slice by slice?” | `Architecture.tsx`, `FieldSlicePlot` | `Heatmap.tsx` pixel indexing and `TensorScenes.tsx` toy Gaussian field, resampled to a unit cube with a fixed grayscale |
| Field → latent → reconstruction | `/#guide-representation/bottleneck` | `Architecture.tsx`, `ReconstructionDiagram` | `Overview.tsx`, `ReconstructionDiagram`, adapted palette and generic no-skip architecture caption |
| Rank versus trainable parameters | `/#guide-evaluation/adaptation`, expand “How does a low-rank adapter reduce trainable parameters?” | `Learning.tsx`, `LoraRankPlot` | `Overview.tsx`, `LoraExplainer` matrix-shape experiment, retaining ranks 1, 2, 4 and 8 and the no-saving boundary |

Implementation paths are relative to `frontend/src/content/guide/`. The slice figure uses fixed [0, 1] brightness across all slices. The reconstruction schematic is not a forecast. The adapter diagram shows parameter slots, not values, and does not claim that higher rank improves accuracy.

### Example plots

Use the **Example plots** page in the guide navigation:

| Open | Source-derived interaction |
|---|---|
| `/#example-tensors/tensor` | Follow the same tensor through input, crop separation and batch folding |
| `/#example-cnn/convolution` | Move a kernel through a toy field, expand from 2D to 3D, then halve each axis with stride 2 |
| `/#example-attention/attention` | Move the query, compare heads, and expand a plane into tiled 3D windows |

These adapt `TensorExplorer`, `ConvolutionScene` and `AttentionScene` from Cool Frog's `TensorScenes.tsx`. Values are synthetic. The tensor example only rearranges input values into crops and batch entries, without network or latent-layout modes. Convolution computes a fixed Sobel kernel on a Gaussian blob. Attention computes toy softmax weights and a weighted value sum, showing only the strongest four links.

Source colors and shared rendering primitives are retained, with local imports and standalone controls. Cube/index arithmetic inspection is intentionally omitted in both applications.

Attention keeps query position, head comparison, partner inspection and the 4³/8³/16³ grids accessible. The initial view includes the score, softmax and weighted-sum formulas with symbol definitions and a note distinguishing the toy score scale from standard attention. Named disclosures hold head comparison, numerical precision and synthetic-vector construction. Only the active window and a faint grid boundary are outlined, keeping non-contributing context quiet without changing the calculation.

The attention formula sits beneath the 3D view. A single coordinate label maps the live query and partner to compact r/i notation. Score, weight and output update with the sliders and selected partner, with rounded results aligned separately from the expressions. The outlined partner’s weight × value shows its individual contribution, while the output sums the full active window.

Each formula symbol has one color shared by its cube, outline, link, callout and formula term: query qᵣ, selected partner kᵢ/vᵢ and weights aᵣ,ᵢ. Callouts beside the plot name qᵣ, kᵢ/vᵢ and W(r), tied to their elements by leader lines. `Scene`'s `callouts` prop places the boxes only when anchors, bounds or size change, so orbiting moves just the leader lines. Narrow screens show symbols without words. The scene’s accessible description includes the same symbol mapping and coordinates.

The CNN and tensor plots use the same pattern. CNN: the live formula y_p = Σ w_o x_{sp+o} sits beneath the plot. The kernel outline, kernel-table weights and w_o share one color, output outline, link and y_p another, and callouts name w_o, x and y_p. Fills keep the value colormaps. Tensor: the colored shape notation sits directly beneath the plot, and callouts name its symbols per stage (B, C, X·Y·Z, then U·V·W or N and H) on one representative field or crop.

Plotting libraries, mathematics and the adaptation workflow are documented in `../template/README.md`.

## Verify

```sh
npm --prefix frontend run build
```

For the complex guide, leave the API stopped. Open all four pages and every chapter, use the illustrative controls, and verify that no `/api` or dataset requests occur. Confirm page navigation and the page-specific outline agree, section deep links work, and disclosures and controls preserve state when switching pages. Example plots should retain Cool Frog's source styling rather than introducing a different visual system.

For the optional Python-backed example, start the API before checking its contract:

```sh
curl --fail http://127.0.0.1:8000/api/health
curl --fail http://127.0.0.1:8000/api/decomposition \
  -H 'Content-Type: application/json' \
  -d '{"potential":1,"rotation":0.5}'
```

The second response must have divergence `2` and curl `1`. Check that every total vector equals the sum of its components. Send an out-of-range strength and confirm HTTP 422.

In the actual browser, change both strengths and confirm all three component plots update together. Inspect a point and confirm it is highlighted across the comparison. Navigate chapter sections and back, reload a deep link, expand disclosures, and switch themes. Verify that experiment state survives chapter navigation, explicit theme choice survives reload, the mobile menu works, and all controls are usable by keyboard. Check that the desktop sidebar is compact, controls sit above the plots, and narrow screens stack the comparison without page overflow. Inspect both themes with an accessibility scanner and visually check the result.

For a research report, also verify source links, claim locators, paper versions, reported values, and ranking criteria against the original evidence.

## Local-use boundary

See `../template/README.md`. The examples add no authentication, remote search, uploads, persistence or code execution.
