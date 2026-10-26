import { Disclosure, Eq, InlineMath } from '../../components/ui'

export function TaskSection() {
  return <div className="max-w-3xl space-y-4 text-sm leading-relaxed">
    <p>
      Solving the equations of a physical system can take hours per case, for example the temperature across a heat sink
      or the airflow around a wing. A <strong>surrogate model</strong> is a trained function that returns an approximate
      answer at a fraction of that cost. It learns from cases that were already solved instead of solving the equations again.
    </p>
    <p>
      What it returns is a <strong>field</strong>: a value at every location, such as the temperature at each point of the heat sink.
      The inputs are the conditions that define the case, such as geometry, material and the fan speed.
    </p>
    <Eq>{String.raw`u = \mathcal{G}(a) \;\approx\; f_\theta(a)`}</Eq>
    <p className="text-ink-muted">
      Here <InlineMath>a</InlineMath> are the conditions, <InlineMath>u(x)</InlineMath> is the resulting field at location{' '}
      <InlineMath>x</InlineMath>, <InlineMath>{String.raw`\mathcal{G}`}</InlineMath> is the expensive reference solver (or experiment),
      and <InlineMath>{String.raw`f_\theta`}</InlineMath> is the surrogate whose parameters <InlineMath>{String.raw`\theta`}</InlineMath> are
      learned from examples. Whether the approximation is good enough depends on where in the field the error falls and in which units.
    </p>
    <Disclosure label="How is predicting a field different from predicting one number?">
      <p>
        A single number might estimate total heat transfer. A field prediction must also place hot and cold regions correctly.
        Two fields can have the same mean while differing at the one location that matters, such as the hottest spot.
      </p>
    </Disclosure>
    <p id="source-s4-task" className="text-xs text-ink-muted">
      Background: the field-as-function view follows <a href="https://arxiv.org/abs/2010.08895" className="underline" target="_blank" rel="noreferrer">S4</a> §2 to 3
      (Li et al., 2020, arXiv v3, accessed 2026-10-24). This guide does not use or restate that paper's reported performance.
    </p>
  </div>
}

export function WorkflowSection() {
  return <div className="space-y-4">
    <p className="max-w-3xl text-sm leading-relaxed">
      The surrogate knows only what the reference solver showed it. Training runs the solver on a set of conditions to
      build <InlineMath>{String.raw`N`}</InlineMath> pairs <InlineMath>{String.raw`(a_i, u_i)`}</InlineMath>, then adjusts the model until its
      output matches each stored field. Afterwards a new set of conditions goes through the model alone.
    </p>
    <div role="img" aria-label="Training data: conditions go through a reference solver to give a reference field. Prediction after training: new conditions go through the trained model to give a predicted field. Reference fields supervise training but are not supplied as answers at prediction time."
      className="rounded-xl bg-surface p-4 ring-1 ring-divider-soft">
      <div className="grid gap-4 text-sm md:grid-cols-[8rem_minmax(0,1fr)]">
        <p className="self-center text-xs text-ink-muted">Training data (slow, once)</p>
        <div className="grid grid-cols-1 items-center gap-2 text-center sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <span className="rounded-lg bg-paper px-3 py-3">Conditions</span><span aria-hidden="true" className="text-ink-muted max-sm:rotate-90">→</span>
          <span className="rounded-lg bg-paper px-3 py-3">Reference solver</span><span aria-hidden="true" className="text-ink-muted max-sm:rotate-90">→</span>
          <span className="rounded-lg bg-paper px-3 py-3">Reference field</span>
        </div>
        <p className="self-center text-xs text-ink-muted">Prediction (fast, repeated)</p>
        <div className="grid grid-cols-1 items-center gap-2 text-center sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <span className="rounded-lg bg-paper px-3 py-3">New conditions</span><span aria-hidden="true" className="text-ink-muted max-sm:rotate-90">→</span>
          <span className="rounded-lg bg-paper px-3 py-3">Trained model</span><span aria-hidden="true" className="text-ink-muted max-sm:rotate-90">→</span>
          <span className="rounded-lg bg-paper px-3 py-3">Predicted field</span>
        </div>
      </div>
    </div>
    <div className="max-w-3xl space-y-4 text-sm leading-relaxed">
      <Eq>{String.raw`\theta^{\ast} = \arg\min_{\theta}\; \frac{1}{N}\sum_{i=1}^{N} \ell\bigl(f_\theta(a_i),\, u_i\bigr)`}</Eq>
      <p className="text-ink-muted">
        <InlineMath>{String.raw`\theta^{\ast}`}</InlineMath> are the parameters that give the smallest average mismatch{' '}
        <InlineMath>{String.raw`\ell`}</InlineMath> between predicted and reference fields. How to define that mismatch is the subject of the loss section on the Learning page.
      </p>
    </div>
    <Disclosure label="When does the up-front cost pay off?" className="max-w-3xl">
      <p>
        A prediction is cheap, the workflow is not. Compare building the data and training once with solving every query directly,
        where <InlineMath>M</InlineMath> is the number of queries and <InlineMath>{String.raw`c`}</InlineMath> a cost per run:
      </p>
      <Eq>{String.raw`N\,c_{\text{sim}} + c_{\text{train}} + M\,c_{\text{pred}} \;<\; M\,c_{\text{sim}}`}</Eq>
      <p className="text-ink-muted">
        Illustrative numbers: with 1 hour per simulation, 500 training cases and 5 hours of training cost about 505 hours, while solving 5,000 queries
        directly costs 5,000 hours. With only 300 queries the surrogate loses. The saving also holds only for conditions the model was shown to handle,
        and anything outside that range needs new simulations.
      </p>
    </Disclosure>
  </div>
}

export function UseCaseSection() {
  return <div className="max-w-3xl space-y-4 text-sm leading-relaxed">
    <p>
      A surrogate helps when many answers are needed and each can be somewhat wrong. The deciding question is what a wrong
      prediction costs, because that sets how much checking the model needs before anyone relies on it.
    </p>
    <dl className="divide-y divide-divider-soft">
      <div className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr]"><dt className="font-medium">Screening designs</dt><dd className="text-ink-muted">Rank thousands of candidate heat sinks in minutes, then re-run only the best few with the reference solver. A mistaken ranking wastes one check.</dd></div>
      <div className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr]"><dt className="font-medium">Starting guess</dt><dd className="text-ink-muted">Hand the predicted field to the solver as its initial state. The solver still converges to its own answer, so a poor guess costs iterations, not correctness.</dd></div>
      <div className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr]"><dt className="font-medium">Deciding directly</dt><dd className="text-ink-muted">Using the prediction instead of a simulation, for a safety or cost-critical choice, needs an error target on the quantity that matters and independent checks against the solver. A low average error does not guarantee that.</dd></div>
    </dl>
  </div>
}

export function ScopeSection() {
  return <div className="max-w-3xl space-y-4 text-sm leading-relaxed">
    <p>
      Understanding how a model is built does not tell you how well it works. A network trained on heat sinks with two to six fins says
      nothing reliable about one with ten, however convincing its pictures look. Accuracy has to be measured for the geometry,
      resolution and physical regime you intend to use, and the next page shows how.
    </p>
    <p className="text-ink-muted">
      Every plot here is a self-contained teaching illustration with made-up signals and values. None uses a dataset or trained weights,
      and none reports the performance of a real model.
    </p>
    <Disclosure label="What would turn this explanation into an evidence-backed model report?">
      <p>
        Name the model, the source publications, the data provenance, the evaluation protocol and the intended use.
        Link each performance claim to the setting and result where it was reported, and keep those findings apart from the general concepts explained here.
      </p>
    </Disclosure>
  </div>
}
