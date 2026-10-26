/** Fixed decimals with a true minus sign, for readable tabular numbers. */
export function formatNumber(value: number, decimals = 2): string {
  return value.toFixed(decimals).replace('-', '\u2212')
}

export function errorMessage(error: unknown): string {
  if (error instanceof TypeError) return 'The server did not respond.'
  return error instanceof Error ? error.message : String(error)
}
