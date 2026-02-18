'use client'

import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type ServerAction = (formData: FormData) => void | Promise<void>

type PodActionsMenuProps = {
  canStart: boolean
  canStop: boolean
  startAction: ServerAction
  stopAction: ServerAction
  deleteAction: ServerAction
}

export function PodActionsMenu({
  canStart,
  canStop,
  startAction,
  stopAction,
  deleteAction,
}: PodActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="Open actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-32">
        {canStart ? (
          <form action={startAction}>
            <DropdownMenuItem asChild>
              <button type="submit" className="w-full text-left">
                Start
              </button>
            </DropdownMenuItem>
          </form>
        ) : null}
        {canStop ? (
          <form action={stopAction}>
            <DropdownMenuItem asChild>
              <button type="submit" className="w-full text-left">
                Stop
              </button>
            </DropdownMenuItem>
          </form>
        ) : null}
        <form action={deleteAction}>
          <DropdownMenuItem asChild variant="destructive">
            <button type="submit" className="w-full text-left">
              Delete
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
