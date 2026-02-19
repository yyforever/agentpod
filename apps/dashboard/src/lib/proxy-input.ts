import { z } from 'zod'

const podIdSchema = z.string().uuid()
const encodedTraversalPattern = /%2e|%2f|%5c/i

export function containsPathTraversal(value: string): boolean {
  return (
    value.includes('..') ||
    value.includes('/') ||
    value.includes('\\') ||
    encodedTraversalPattern.test(value)
  )
}

export function validatePodId(value: string): string | null {
  if (containsPathTraversal(value)) {
    return null
  }

  const parsed = podIdSchema.safeParse(value)
  if (!parsed.success) {
    return null
  }

  return parsed.data
}

export function validatePathParam(value: string): string | null {
  if (!value || containsPathTraversal(value)) {
    return null
  }

  return value
}

export function hasUnsafeSearchParams(params: URLSearchParams): boolean {
  for (const [key, value] of params.entries()) {
    if (containsPathTraversal(key) || containsPathTraversal(value)) {
      return true
    }
  }

  return false
}
