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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type ServerAction = (formData: FormData) => void | Promise<void>

type TenantRowActionsProps = {
  tenantId: string
  tenantName: string
  tenantEmail: string | null
  updateAction: ServerAction
  deleteAction: ServerAction
}

export function TenantRowActions({
  tenantId,
  tenantName,
  tenantEmail,
  updateAction,
  deleteAction,
}: TenantRowActionsProps) {
  const [updateOpen, setUpdateOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <div className="flex items-center justify-end gap-2">
      <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            Edit
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Tenant</DialogTitle>
            <DialogDescription>Update tenant name and contact email.</DialogDescription>
          </DialogHeader>
          <form action={updateAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`tenant-name-${tenantId}`}>Name</Label>
              <Input id={`tenant-name-${tenantId}`} name="name" defaultValue={tenantName} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`tenant-email-${tenantId}`}>Email</Label>
              <Input
                id={`tenant-email-${tenantId}`}
                name="email"
                type="email"
                defaultValue={tenantEmail ?? ''}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setUpdateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="destructive" size="sm">
            Delete
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Tenant?</DialogTitle>
            <DialogDescription>
              This tenant can only be deleted when it has no pods.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
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
