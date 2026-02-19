'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

type PodLogsResponse = {
  logs: string
}

type PodLogsViewerProps = {
  podId: string
}

const DEFAULT_TAIL_LINES = 400

export function PodLogsViewer({ podId }: PodLogsViewerProps) {
  const [logs, setLogs] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)

  const endpoint = useMemo(
    () => `/api/pods/${podId}/logs?tail=${DEFAULT_TAIL_LINES}`,
    [podId],
  )

  const loadLogs = useCallback(async () => {
    setIsRefreshing(true)
    setError(null)

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })

      const payload = (await response.json()) as PodLogsResponse & {
        error?: string
        message?: string
      }

      if (!response.ok) {
        throw new Error(payload.error ?? payload.message ?? 'failed to load logs')
      }

      setLogs(payload.logs)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'failed to load logs')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [endpoint])

  useEffect(() => {
    void loadLogs()
  }, [loadLogs])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    viewport.scrollTop = viewport.scrollHeight
  }, [logs])

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            void loadLogs()
          }}
          disabled={isRefreshing}
        >
          <RefreshCw className={`mr-2 size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div
        ref={viewportRef}
        className="max-h-80 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-3"
      >
        {isLoading ? (
          <p className="text-sm text-zinc-400">Loading logs...</p>
        ) : error ? (
          <p className="text-sm text-red-300">{error}</p>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-zinc-200">
            {logs.length > 0 ? logs : 'No logs available.'}
          </pre>
        )}
      </div>
    </div>
  )
}
