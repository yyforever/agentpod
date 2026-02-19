import { Hono } from 'hono'
import type { PodService } from '@agentpod/core'
import { CoreError } from '@agentpod/core'
import { z } from 'zod'

type AdapterFieldSchema = {
  type: 'string' | 'boolean' | 'number'
  enum?: string[]
  default?: unknown
}

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return unwrapSchema(schema.unwrap())
  }

  if (schema instanceof z.ZodDefault) {
    return unwrapSchema(schema.removeDefault())
  }

  if (schema instanceof z.ZodEffects) {
    return unwrapSchema(schema.innerType())
  }

  return schema
}

function isRequiredField(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return false
  }

  if (schema instanceof z.ZodEffects) {
    return isRequiredField(schema.innerType())
  }

  return true
}

function toFieldSchema(schema: z.ZodTypeAny): AdapterFieldSchema {
  const unwrapped = unwrapSchema(schema)

  if (unwrapped instanceof z.ZodBoolean) {
    return { type: 'boolean' }
  }

  if (unwrapped instanceof z.ZodNumber) {
    return { type: 'number' }
  }

  if (unwrapped instanceof z.ZodEnum) {
    return { type: 'string', enum: [...unwrapped.options] }
  }

  if (unwrapped instanceof z.ZodNativeEnum) {
    const options = Object.values(unwrapped.enum).filter(
      (value): value is string => typeof value === 'string',
    )
    return { type: 'string', enum: options }
  }

  return { type: 'string' }
}

export function createAdapterRoutes(podService: PodService): Hono {
  const app = new Hono()

  app.get('/adapters', async (c) => {
    const adapters = podService
      .getAdapterRegistry()
      .list()
      .map((adapter) => adapter.meta)
    return c.json(adapters)
  })

  app.get('/adapters/:id/config-schema', async (c) => {
    const adapter = podService.getAdapterRegistry().get(c.req.param('id'))
    if (!adapter) {
      throw new CoreError('NOT_FOUND', 'adapter not found', 404)
    }

    const shape = adapter.configSchema.schema.shape
    const properties = Object.fromEntries(
      Object.entries(shape).map(([key, value]) => {
        const defaultValue =
          Object.prototype.hasOwnProperty.call(adapter.configSchema.defaults, key)
            ? adapter.configSchema.defaults[key]
            : undefined
        return [
          key,
          {
            ...toFieldSchema(value),
            ...(defaultValue !== undefined ? { default: defaultValue } : {}),
          },
        ]
      }),
    )

    const required = Object.entries(shape)
      .filter(([, value]) => isRequiredField(value))
      .map(([key]) => key)

    return c.json({
      adapter_id: adapter.meta.id,
      schema: {
        type: 'object',
        properties,
        required,
      },
      ui_hints: adapter.configSchema.uiHints,
      defaults: adapter.configSchema.defaults,
    })
  })

  return app
}
