import { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { hasUnsafeSearchParams } from '@/lib/proxy-input'

const controlPlaneBaseUrl = process.env.CONTROL_PLANE_URL ?? 'http://localhost:4000'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest): Promise<Response> {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  if (hasUnsafeSearchParams(request.nextUrl.searchParams)) {
    return Response.json({ error: 'invalid query params' }, { status: 400 })
  }

  const url = new URL('/api/pods/events', controlPlaneBaseUrl)
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value)
  })

  const headers = new Headers()
  headers.set('accept', 'text/event-stream')

  if (process.env.AGENTPOD_API_KEY) {
    headers.set('authorization', `Bearer ${process.env.AGENTPOD_API_KEY}`)
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
    cache: 'no-store',
  })

  if (!response.ok || !response.body) {
    const body = JSON.stringify({ error: 'failed to connect to control-plane event stream' })
    return new Response(body, {
      status: response.status || 502,
      headers: { 'content-type': 'application/json' },
    })
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
