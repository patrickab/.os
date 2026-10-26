# Interactive learning skill

Reusable instructions, an empty React + FastAPI template, and finished teaching examples on the same shell. Inspired by Cool Frog's frontend, without its datasets, models, or application dependencies.

## Install

Copy this entire directory, including `template/` and `example/`, into your coding assistant's skill directory. For assistants using the `~/.agents/skills` convention, run from the Cool Frog repository root:

```sh
mkdir -p ~/.agents/skills
cp -R skills/interactive-learning ~/.agents/skills/
```

Check for an existing installation before copying. Other assistants may use a different skill directory. `SKILL.md` contains the discoverable name and description. The adjacent `template/` and `example/` must travel with it.

## Try the examples

From this skill's directory:

```sh
./example/run.sh                  # both examples
./example/run.sh --frontend-only  # scientific model guide only, no Python
./template/run.sh                 # empty template
```

Open `http://127.0.0.1:5173`. Press Ctrl+C to stop the preview.

## Use

Example requests:

- “Use interactive-learning to explain Helmholtz decomposition for someone who knows vector calculus.”
- “Use interactive-learning to explain scientific surrogate models, including their architecture, training, and evaluation, as a layered multi-page guide.”
- “Use interactive-learning to search for scientific publications about neural PDE solvers and create an evidence-backed report. Prioritize reproducible results on irregular geometries.”

The assistant copies `template/` to `./interactive_applets/<topic>/` in the current working directory, writes the lesson into `lessons.tsx` and `content/`, performs any requested research, and verifies the finished application. Later requests on the same topic update that app in place. The shell needs no code changes. See [template/README.md](template/README.md) for commands, shared building blocks and libraries.

The agent chooses a single-page lesson or a multi-page structure from the query, then scales explanation depth to the request, audience, and concept complexity. `example/` shows both: a focused field-decomposition lesson with a Python experiment, and a frontend-only scientific model guide whose **Example plots** page holds Cool Frog's interactive tensor, CNN and attention scenes. See [example/README.md](example/README.md) for sources and deep links.

Installing other well-established JavaScript/TypeScript or Python libraries is allowed when they significantly improve or simplify a visual explanation, such as map libraries for satellite data or Observable Plot, Vega-Lite, Mafs and JSXGraph for plotting.

The skill defines a research workflow, not a bundled search service. Network research requires the assistant's search tools or an explicitly implemented integration. The template contains no fabricated publications or live-search claims.

The workflow separates research from implementation: read-only scouts inspect educational and scientific sources and return compact evidence briefs, coding agents build the approved material, and the orchestrator visually checks the result and balances explanatory depth. Source discovery includes arXiv, Google Scholar, author/coauthor publications, and backward/forward citations. Use reputable news only when relevant. Reddit and anonymous forum discussions are excluded.

The orchestrator removes noise and redundant wording, restores missing definitions or causal steps, and keeps useful secondary detail behind specific disclosures. It does not need raw source dumps or implementation transcripts in its main context.

## Contents

```text
interactive-learning/
├── SKILL.md                 Authoring, design, research, and verification rules
├── README.md                Installation and invocation
├── template/                Empty runnable app, copy this into a new project
│   ├── README.md            Setup, shared building blocks, libraries, verification
│   ├── run.sh               One-command preview launcher
│   ├── backend/             FastAPI app with health endpoint
│   └── frontend/            Shared shell: navigation, theme, UI, 3D scene, plot colors
└── example/                 Two finished lessons on the identical shell, reference only
    ├── README.md            Examples, scientific contract, provenance
    ├── backend/             Validated analytic vector-field API
    └── frontend/src/content Guide pages, Helmholtz lesson, tensor/CNN/attention plots
```

Keep the skill instructions for the assistant and the copied README for application users. The generated application does not need the original skill to run.
