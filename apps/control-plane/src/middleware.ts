import type { Context, MiddlewareHandler } from 'hono'
import { isCoreError } from '@agentpod/core'

type JsonBody = {
  error: string
  code?: string
  details?: unknown
}

const authDisabledWarning =
  'AGENTPOD_API_KEY is not set; API authentication is disabled (development mode)'

if (!process.env.AGENTPOD_API_KEY) {
  console.warn(authDisabledWarning)
}

function toErrorResponse(c: Context, error: unknown) {
  if (isCoreError(error)) {
    const body: JsonBody = {
      error: error.message,
      code: error.code,
    }

    if (error.details !== undefined) {
      body.details = error.details
    }

    return c.json(body, error.statusCode)
  }

  const fallback = error instanceof Error ? error.message : 'internal server error'
  const body: JsonBody = {
    error: fallback,
  }

  return c.json(body, 500)
}

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const startedAt = Date.now()
  await next()
  const durationMs = Date.now() - startedAt
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${durationMs}ms`)
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const apiKey = process.env.AGENTPOD_API_KEY
  if (!apiKey) {
    await next()
    return
  }

  const authorization = c.req.header('authorization')
  if (authorization !== `Bearer ${apiKey}`) {
    return c.json(
      {
        code: 'UNAUTHORIZED',
        message: 'missing or invalid API key',
      },
      401,
    )
  }

  await next()
}

export const errorHandler = (error: unknown, c: Context) => {
  return toErrorResponse(c, error)
}
