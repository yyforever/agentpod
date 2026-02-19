import { NextRequest } from 'next/server'
import { auth } from '@/auth'

const controlPlaneBaseUrl = process.env.CONTROL_PLANE_URL ?? 'http://localhost:4000'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<Response> {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const url = new URL(`/api/pods/${id}/logs`, controlPlaneBaseUrl)
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value)
  })

  const headers = new Headers()
  headers.set('accept', 'application/json')

  if (process.env.AGENTPOD_API_KEY) {
    headers.set('authorization', `Bearer ${process.env.AGENTPOD_API_KEY}`)
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
    cache: 'no-store',
  })

  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json',
    },
  })
}
