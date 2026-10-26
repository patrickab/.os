import { fetchJson } from './lib/http'

/** Server contract. The backend owns validation and computation, the client only displays the response. */
export type Health = { status: string }

export const getHealth = (signal: AbortSignal) => fetchJson<Health>('/api/health', signal)
