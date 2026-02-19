'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

type PodStatusEventPayload = {
  pod_id: string
}

type PodStatusEventsListenerProps = {
  podId?: string
}

const MIN_REFRESH_INTERVAL_MS = 500

export function PodStatusEventsListener({ podId }: PodStatusEventsListenerProps) {
  const router = useRouter()
  const lastRefreshAtRef = useRef(0)

  useEffect(() => {
    const source = new EventSource('/api/pods/events')

    const refresh = (): void => {
      const now = Date.now()
      if (now - lastRefreshAtRef.current < MIN_REFRESH_INTERVAL_MS) {
        return
      }

      lastRefreshAtRef.current = now
      router.refresh()
    }

    const onStatusEvent = (event: MessageEvent<string>): void => {
      try {
        const payload = JSON.parse(event.data) as PodStatusEventPayload
        if (!podId || payload.pod_id === podId) {
          refresh()
        }
      } catch {
        refresh()
      }
    }

    source.addEventListener('pod.status', onStatusEvent as EventListener)

    return () => {
      source.removeEventListener('pod.status', onStatusEvent as EventListener)
      source.close()
    }
  }, [podId, router])

  return null
}
