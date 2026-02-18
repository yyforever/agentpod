'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

type ServerAction = (formData: FormData) => void | Promise<void>

type PodDetailActionsProps = {
  canStart: boolean
  canStop: boolean
  startAction: ServerAction
  stopAction: ServerAction
  deleteAction: ServerAction
}

export function PodDetailActions({
  canStart,
  canStop,
  startAction,
  stopAction,
  deleteAction,
}: PodDetailActionsProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-wrap gap-2">
      {canStart ? (
        <form action={startAction}>
          <Button type="submit">Start</Button>
        </form>
      ) : null}
      {canStop ? (
        <form action={stopAction}>
          <Button type="submit" variant="secondary">
            Stop
          </Button>
        </form>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="destructive">Delete</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Pod?</DialogTitle>
            <DialogDescription>
              This marks the pod as deleted and removes its container during reconciliation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <form action={deleteAction}>
              <Button type="submit" variant="destructive">
                Confirm Delete
              </Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
