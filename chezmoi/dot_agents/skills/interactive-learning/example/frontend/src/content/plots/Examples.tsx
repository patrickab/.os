import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { Disclosure, Eq, InlineMath } from '../../components/ui'

const TensorExample = lazy(() => import('./TensorExample').then((module) => ({ default: module.TensorExample })))
const ConvolutionExample = lazy(() => import('./MixingExamples').then((module) => ({ default: module.ConvolutionExample })))
const AttentionExample = lazy(() => import('./MixingExamples').then((module) => ({ default: module.AttentionExample })))

function PlotLoading({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p role="status" className="text-sm text-ink-muted">Loading interactive plot…</p>}>{children}</Suspense>
}

export function TensorPlotSection() {
  return <div className="space-y-4 text-sm leading-relaxed [&>p]:max-w-3xl">
    <p>
      A network receives a field as a <strong>tensor</strong>: an array whose axes have names.
      A batch of 3D simulations has shape <InlineMath>{String.raw`(B, C, X, Y, Z)`}</InlineMath>: <InlineMath>B</InlineMath> samples, <InlineMath>C</InlineMath> channels such as pressure or temperature, and <InlineMath>{String.raw`X \times Y \times Z`}</InlineMath> grid points.
    </p>
    <p>
      Full simulation grids rarely fit through a network at once, so they are cut into equal crops of <InlineMath>{String.raw`H \times H \times H`}</InlineMath> points.
      Each crop then becomes its own batch entry. The batch axis holds independent items that are processed in parallel with the same weights.
      Follow the cubes through the three stages: values never change, only the axis they belong to.
    </p>
    <PlotLoading><TensorExample /></PlotLoading>
    <p>
      <strong>What folding costs.</strong> Batch entries never exchange information, so a crop cannot see across its own border.
      Structures larger than <InlineMath>H</InlineMath> are only seen in pieces unless crops overlap or the model reassembles them later.
      This example also folds <InlineMath>C</InlineMath> into the batch, so every crop holds one scalar field. A model that relates channels to each other keeps <InlineMath>C</InlineMath> as its own axis.
    </p>
  </div>
}

export function ConvolutionPlotSection() {
  return <div className="space-y-4 text-sm leading-relaxed [&>p]:max-w-3xl">
    <p>
      In a physical field, a value depends mostly on its neighbors, and the same pattern, such as a sharp front, can appear anywhere.
      A <strong>convolution</strong> builds both facts in: each output reads only a small neighborhood (<strong>locality</strong>), and every position uses the same kernel weights (<strong>weight sharing</strong>).
    </p>
    <p>
      Weight sharing makes the layer cheap and consistent. On this 8³ grid, a 3 × 3 × 3 kernel has 27 weights, while connecting all 512 inputs to all 512 outputs would take 262,144.
      Shifting a pattern in the input shifts its response in the output by the same amount.
    </p>
    <PlotLoading><ConvolutionExample /></PlotLoading>
    <p>
      <strong>How far an output sees.</strong> One 3 × 3 × 3 kernel reads a 3-point neighborhood per axis. Stacking layers widens this <strong>receptive field</strong> to 5, 7, … points, and every stride 2 doubles the reach of all later layers.
      Distant regions only interact after many layers, which motivates attention below.
    </p>
    <Disclosure label="How does a real convolution layer differ from this example?">
      <p>A layer has many input channels <InlineMath>c</InlineMath> and many output channels <InlineMath>{String.raw`c'`}</InlineMath>, each with its own learned kernel and bias, followed by a nonlinearity <InlineMath>\sigma</InlineMath>.</p>
      <Eq>{String.raw`y_{c',p} = \sigma\Big(b_{c'} + \sum_{c}\sum_{o\in K} w_{c',c,o}\, x_{c,\,sp+o}\Big)`}</Eq>
      <p className="text-ink-muted">
        The example keeps one channel, no bias and no nonlinearity, and uses a fixed edge-detecting kernel instead of learned weights.
        Trained early layers often learn similar edge and gradient detectors. Deep-learning libraries compute this formula without flipping the kernel, which mathematicians call cross-correlation.
      </p>
    </Disclosure>
  </div>
}

export function AttentionPlotSection() {
  return <div className="space-y-4 text-sm leading-relaxed [&>p]:max-w-3xl">
    <p>
      A convolution mixes neighbors with fixed weights, whatever the field looks like. <strong>Attention</strong> computes the weights from the content itself, so a location can draw more from partners that are relevant to it.
    </p>
    <p>
      Every location carries a feature vector <InlineMath>h</InlineMath>. Three learned linear maps turn it into a <strong>query</strong> <InlineMath>{String.raw`q = W_Q h`}</InlineMath> (what this location looks for), a <strong>key</strong> <InlineMath>{String.raw`k = W_K h`}</InlineMath> (what it offers to be found by) and a <strong>value</strong> <InlineMath>{String.raw`v = W_V h`}</InlineMath> (what it passes on).
      A query that points in the same direction as a key gives a high score, and softmax turns the scores into weights that sum to 1.
    </p>
    <p>
      Comparing every location with every other is expensive. On an 8³ grid that is already 512² ≈ 262,000 pairs, and the count grows with the square of the grid size.
      <strong> Window attention</strong> only compares locations inside the same 4³ window, so each query has 64 partners however large the grid is.
    </p>
    <PlotLoading><AttentionExample /></PlotLoading>
    <p>
      <strong>What windows cost.</strong> Information cannot cross a window border within one layer. Architectures such as the Swin Transformer shift the window grid by half a window in alternating layers, so neighboring windows exchange information over two layers.
    </p>
  </div>
}
