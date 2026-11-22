/**
 * Small helpers every factory module shares: error text, record check, the end of a command's output.
 */

/** How much of a failed command's output an error message keeps. */
export const ERROR_TAIL_CHARS = 1000;

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The trimmed end of a command's output, `"killed"` when it printed nothing. */
export function outputTail(output: string, chars: number = ERROR_TAIL_CHARS): string {
  return output.trim().slice(-chars) || "killed";
}
