import { Disclosure, Eq, InlineMath } from '../components/ui'

export function HelmholtzIdea() {
  return <div className="max-w-3xl space-y-4 text-sm leading-relaxed">
    <p>
      A flow can do two different things at a point: <strong>spread out</strong> from it, like water from a source, or <strong>spin</strong> around it, like a whirlpool.
      The Helmholtz decomposition separates a vector field <InlineMath>{String.raw`\mathbf{F}`}</InlineMath> into one part that only spreads and one part that only spins.
    </p>
    <p>
      The split matters because the two parts have different physical causes and are treated differently.
      In incompressible fluid simulation, the spreading part of a velocity field is removed so that no fluid is created or destroyed.
      In electrostatics, the electric field is purely of the spreading kind, while a magnetic field only circulates.
    </p>
    <Eq>{String.raw`\mathbf{F} = \underbrace{\nabla\varphi}_{\mathbf{P}} + \mathbf{R}, \qquad \operatorname{curl}\mathbf{P} = 0, \qquad \operatorname{div}\mathbf{R} = 0`}</Eq>
    <p className="text-ink-muted">
      <InlineMath>{String.raw`\mathbf{P}`}</InlineMath> is the gradient of a scalar potential <InlineMath>\varphi</InlineMath>, so it has no spin.{' '}
      <InlineMath>{String.raw`\mathbf{R}`}</InlineMath> is the rotation part and has no spreading.
      Two derivatives measure the two behaviours in the plane:
    </p>
    <Eq>{String.raw`\operatorname{div}\mathbf{F} = \frac{\partial F_x}{\partial x} + \frac{\partial F_y}{\partial y}, \qquad \operatorname{curl}\mathbf{F} = \frac{\partial F_y}{\partial x} - \frac{\partial F_x}{\partial y}`}</Eq>
    <p className="text-ink-muted">
      Divergence is the net outflow per area around a point. Curl is twice the local rotation rate.
      The example below builds <InlineMath>{String.raw`\mathbf{F}`}</InlineMath> from two known parts with strengths <InlineMath>a</InlineMath> and <InlineMath>b</InlineMath>, so you can see each part and their sum. It does not decompose an arbitrary field.
    </p>
    <Disclosure label="Why is the divergence 2a and the curl 2b?">
      <p>The two parts are <InlineMath>{String.raw`\mathbf{P} = a\,(x, y)`}</InlineMath> and <InlineMath>{String.raw`\mathbf{R} = b\,(-y, x)`}</InlineMath>. Their sum is</p>
      <Eq>{String.raw`\begin{aligned} F_x &= a x - b y, \\ F_y &= a y + b x \end{aligned}`}</Eq>
      <p>Insert into the two definitions.</p>
      <Eq>{String.raw`\operatorname{div}\mathbf{F} = a + a = 2a, \qquad \operatorname{curl}\mathbf{F} = b - (-b) = 2b`}</Eq>
      <p className="text-ink-muted">
        <InlineMath>{String.raw`\mathbf{P}`}</InlineMath> is the gradient of <InlineMath>{String.raw`\varphi = \tfrac{a}{2}(x^2 + y^2)`}</InlineMath>, so it contributes no curl.{' '}
        <InlineMath>{String.raw`\mathbf{R}`}</InlineMath> contributes no divergence because{' '}
        <InlineMath>{String.raw`\frac{\partial(-b y)}{\partial x} + \frac{\partial(b x)}{\partial y} = 0`}</InlineMath>.
      </p>
    </Disclosure>
  </div>
}
