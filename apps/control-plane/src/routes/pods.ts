import { Hono } from 'hono'
import { CoreError } from '@agentpod/core'
import type { PodService } from '@agentpod/core'
import { z } from 'zod'

const createPodBodySchema = z.object({
  tenant_id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  adapter_id: z.string().trim().min(1),
  config: z.record(z.unknown()).optional(),
})

export function createPodRoutes(podService: PodService): Hono {
  const app = new Hono()

  app.post('/pods', async (c) => {
    const json = await c.req.json().catch(() => {
      throw new CoreError('VALIDATION_ERROR', 'invalid JSON body', 400)
    })
    const body = createPodBodySchema.safeParse(json)
    if (!body.success) {
      throw new CoreError('VALIDATION_ERROR', 'invalid request body', 400, body.error.issues)
    }

    const pod = await podService.create({
      tenantId: body.data.tenant_id,
      name: body.data.name,
      adapterId: body.data.adapter_id,
      config: body.data.config,
    })

    return c.json(pod, 201)
  })

  app.get('/pods', async (c) => {
    const tenantId = c.req.query('tenant_id')
    const rows = await podService.list(tenantId)
    return c.json(rows)
  })

  app.get('/pods/events', async (c) => {
    const encoder = new TextEncoder()
    let lastSeenAt = new Date()

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let isClosed = false
        let isPolling = false

        const write = (chunk: string): void => {
          if (isClosed) {
            return
          }
          controller.enqueue(encoder.encode(chunk))
        }

        const writeEvent = (event: string, data: unknown): void => {
          write(`event: ${event}\n`)
          write(`data: ${JSON.stringify(data)}\n\n`)
        }

        const poll = async (): Promise<void> => {
          if (isClosed || isPolling) {
            return
          }
          isPolling = true
          try {
            const changes = await podService.listStatusChangesSince(lastSeenAt)
            if (changes.length === 0) {
              write(': keepalive\n\n')
              return
            }

            for (const change of changes) {
              writeEvent('pod.status', {
                pod_id: change.pod_id,
                actual_status: change.actual_status,
                desired_status: change.desired_status,
                phase: change.phase,
                message: change.message,
                updated_at: change.updated_at.toISOString(),
              })
              if (change.updated_at > lastSeenAt) {
                lastSeenAt = change.updated_at
              }
            }
          } catch (error) {
            writeEvent('stream.error', {
              message: error instanceof Error ? error.message : 'failed to load status updates',
            })
          } finally {
            isPolling = false
          }
        }

        writeEvent('connected', { at: new Date().toISOString() })
        void poll()

        const interval = setInterval(() => {
          void poll()
        }, 2_000)

        c.req.raw.signal.addEventListener(
          'abort',
          () => {
            if (isClosed) {
              return
            }
            isClosed = true
            clearInterval(interval)
            controller.close()
          },
          { once: true },
        )
      },
    })

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    })
  })

  app.get('/pods/:id', async (c) => {
    const row = await podService.getById(c.req.param('id'))
    return c.json(row)
  })

  app.delete('/pods/:id', async (c) => {
    const id = c.req.param('id')
    await podService.delete(id)
    return c.json({ id, desired_status: 'deleted' })
  })

  app.post('/pods/:id/stop', async (c) => {
    const id = c.req.param('id')
    await podService.stop(id)
    return c.json({ id, desired_status: 'stopped' })
  })

  app.post('/pods/:id/start', async (c) => {
    const id = c.req.param('id')
    await podService.start(id)
    return c.json({ id, desired_status: 'running' })
  })

  return app
}
