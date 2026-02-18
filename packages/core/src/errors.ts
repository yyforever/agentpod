export class CoreError extends Error {
  readonly code: string
  readonly statusCode: number
  readonly details?: unknown

  constructor(code: string, message: string, statusCode: number, details?: unknown) {
    super(message)
    this.name = 'CoreError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }
}

export function isCoreError(error: unknown): error is CoreError {
  return error instanceof CoreError
}
