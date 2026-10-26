import { useEffect, useState } from 'react'
import type { DependencyList } from 'react'
import { errorMessage } from './format'

/** `previous` is the last successful result while a newer request is running. */
export type RequestState<T> =
  | { status: 'loading'; previous?: T }
  | { status: 'done'; data: T }
  | { status: 'error'; error: string }

/**
 * Run `load` whenever `deps` change and abort the outdated request.
 * `retry` runs the same request again after an error.
 */
export function useRequest<T>(load: (signal: AbortSignal) => Promise<T>, deps: DependencyList): [RequestState<T>, () => void] {
  const [state, setState] = useState<RequestState<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const settle = (next: RequestState<T>) => { if (!controller.signal.aborted) setState(next) }
    setState((current) => ({
      status: 'loading',
      previous: current.status === 'done' ? current.data : current.status === 'loading' ? current.previous : undefined,
    }))
    load(controller.signal).then((data) => settle({ status: 'done', data }), (error) => settle({ status: 'error', error: errorMessage(error) }))
    return () => controller.abort()
    // The caller lists every value `load` reads in `deps`, so `load` itself is not a dependency.
  }, [...deps, attempt])
  return [state, () => setAttempt((count) => count + 1)]
}
