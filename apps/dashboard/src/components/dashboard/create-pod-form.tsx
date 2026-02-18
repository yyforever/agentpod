'use client'

import { useMemo, useState } from 'react'
import type { AdapterMeta, Tenant } from '@agentpod/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type CreatePodFormProps = {
  tenants: Tenant[]
  adapters: AdapterMeta[]
  action: (formData: FormData) => void | Promise<void>
}

export function CreatePodForm({ tenants, adapters, action }: CreatePodFormProps) {
  const initialTenantId = useMemo(() => tenants[0]?.id ?? '', [tenants])
  const initialAdapterId = useMemo(() => adapters[0]?.id ?? '', [adapters])

  const [tenantId, setTenantId] = useState(initialTenantId)
  const [adapterId, setAdapterId] = useState(initialAdapterId)

  return (
    <form action={action} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="tenantId">Tenant</Label>
        <Select value={tenantId} onValueChange={setTenantId}>
          <SelectTrigger id="tenantId" className="w-full">
            <SelectValue placeholder="Select tenant" />
          </SelectTrigger>
          <SelectContent>
            {tenants.map((tenant) => (
              <SelectItem value={tenant.id} key={tenant.id}>
                {tenant.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input type="hidden" name="tenantId" value={tenantId} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Pod Name</Label>
        <Input id="name" name="name" placeholder="my-agent" required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="adapterId">Adapter</Label>
        <Select value={adapterId} onValueChange={setAdapterId}>
          <SelectTrigger id="adapterId" className="w-full">
            <SelectValue placeholder="Select adapter" />
          </SelectTrigger>
          <SelectContent>
            {adapters.map((adapter) => (
              <SelectItem value={adapter.id} key={adapter.id}>
                {adapter.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input type="hidden" name="adapterId" value={adapterId} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="config">Config (JSON)</Label>
        <Textarea
          id="config"
          name="config"
          className="min-h-40 font-mono"
          defaultValue="{}"
          placeholder='{"agentName": "Assistant"}'
        />
      </div>

      <Button type="submit" className="w-full sm:w-auto">
        Create Pod
      </Button>
    </form>
  )
}
