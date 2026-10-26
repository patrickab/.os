import { fetchJson } from './lib/http'

/** Server contract. The backend owns validation and computation, the client only displays the response. */
export type DecompositionRequest = { potential: number; rotation: number }

export type FieldPoint = {
  x: number
  y: number
  potential_x: number
  potential_y: number
  rotation_x: number
  rotation_y: number
  total_x: number
  total_y: number
}

export type Decomposition = {
  potential: number
  rotation: number
  points: FieldPoint[]
  divergence: number
  curl: number
}

export const postDecomposition = (body: DecompositionRequest, signal: AbortSignal) =>
  fetchJson<Decomposition>('/api/decomposition', signal, body)
