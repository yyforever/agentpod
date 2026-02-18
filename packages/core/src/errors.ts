export class CoreError extends Error {
  readonly code: string
  readonly statusCode: 400 | 404 | 409 | 500
  readonly details?: unknown

  constructor(
    code: string,
    message: string,
    statusCode: 400 | 404 | 409 | 500,
    details?: unknown,
  ) {
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
