export type Result<T = void> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      error: string
    }

export function ok<T>(data?: T): Result<T> {
  return { ok: true, data }
}

export function err<T>(msg: string, cause?: unknown): Result<T> {
  let error = msg
  if (cause) {
    if (cause instanceof Error) {
      error += `: ${cause.message}`
    } else {
      error += `: ${String(cause)}`
    }
  }
  return { ok: false, error }
}
