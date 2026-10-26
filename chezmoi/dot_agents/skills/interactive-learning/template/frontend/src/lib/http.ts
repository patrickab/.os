/** Turn a FastAPI error body into one readable line. `detail` is a string or a list of validation errors. */
function detailMessage(detail: unknown): string | undefined {
  if (typeof detail === 'string') return detail
  if (!Array.isArray(detail)) return undefined
  return detail
    .map((item) => {
      if (typeof item?.msg !== 'string') return JSON.stringify(item)
      const where = Array.isArray(item.loc) ? item.loc.filter((part: unknown) => part !== 'body').join('.') : ''
      return where ? `${where}: ${item.msg}` : item.msg
    })
    .join(', ')
}

/** Fetch JSON, POSTing `body` when given. Throws the server's message unless the response is OK. */
export async function fetchJson<T>(url: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    signal,
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (response.ok) return response.json() as Promise<T>
  const text = await response.text()
  let message = text
  try {
    message = detailMessage(JSON.parse(text).detail) ?? text
  } catch { /* A proxy or upstream server may return plain text. */ }
  throw new Error(message || `Request failed (${response.status})`)
}
