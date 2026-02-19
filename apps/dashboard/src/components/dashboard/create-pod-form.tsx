'use client'

import { useEffect, useMemo, useState } from 'react'
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

type AdapterSchemaResponse = {
  adapter_id: string
  schema: {
    type: 'object'
    properties: Record<
      string,
      {
        type: 'string' | 'boolean' | 'number'
        enum?: string[]
        default?: unknown
      }
    >
    required: string[]
  }
  ui_hints: Record<
    string,
    {
      label: string
      help?: string
      sensitive?: boolean
      group?: string
    }
  >
  defaults: Record<string, unknown>
}

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
  const [schema, setSchema] = useState<AdapterSchemaResponse | null>(null)
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [isLoadingSchema, setIsLoadingSchema] = useState(false)
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({})

  useEffect(() => {
    const loadSchema = async () => {
      if (!adapterId) {
        setSchema(null)
        setConfigValues({})
        return
      }

      setIsLoadingSchema(true)
      setSchemaError(null)
      try {
        const response = await fetch(`/api/adapters/${adapterId}/config-schema`, {
          method: 'GET',
          headers: { accept: 'application/json' },
          cache: 'no-store',
        })

        const payload = (await response.json()) as AdapterSchemaResponse & {
          error?: string
          message?: string
        }
        if (!response.ok) {
          throw new Error(payload.error ?? payload.message ?? 'failed to load config schema')
        }

        setSchema(payload)

        const nextConfigValues: Record<string, unknown> = {}
        Object.entries(payload.schema.properties).forEach(([key, property]) => {
          if (Object.prototype.hasOwnProperty.call(payload.defaults, key)) {
            nextConfigValues[key] = payload.defaults[key]
            return
          }

          if (property.default !== undefined) {
            nextConfigValues[key] = property.default
            return
          }

          if (property.type === 'boolean') {
            nextConfigValues[key] = false
            return
          }

          nextConfigValues[key] = ''
        })

        setConfigValues(nextConfigValues)
      } catch (error) {
        setSchema(null)
        setConfigValues({})
        setSchemaError(error instanceof Error ? error.message : 'failed to load config schema')
      } finally {
        setIsLoadingSchema(false)
      }
    }

    void loadSchema()
  }, [adapterId])

  const configJson = useMemo(() => JSON.stringify(configValues), [configValues])

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

      {isLoadingSchema ? (
        <p className="text-sm text-zinc-400">Loading config schema...</p>
      ) : null}
      {schemaError ? <p className="text-sm text-red-400">{schemaError}</p> : null}

      {schema ? (
        <div className="space-y-4 rounded-md border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm font-medium text-zinc-200">Config</p>
          {Object.entries(schema.schema.properties).map(([key, property]) => {
            const hint = schema.ui_hints[key]
            const label = hint?.label ?? key
            const isRequired = schema.schema.required.includes(key)
            const value = configValues[key]

            if (property.type === 'boolean') {
              return (
                <div className="space-y-2" key={key}>
                  <label className="flex items-center gap-3 text-sm text-zinc-200" htmlFor={`config-${key}`}>
                    <input
                      id={`config-${key}`}
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(event) => {
                        setConfigValues((previous) => ({
                          ...previous,
                          [key]: event.target.checked,
                        }))
                      }}
                      className="size-4 rounded border-zinc-700 bg-zinc-950"
                    />
                    {label}
                  </label>
                  {hint?.help ? <p className="text-xs text-zinc-400">{hint.help}</p> : null}
                </div>
              )
            }

            if (property.enum && property.enum.length > 0) {
              return (
                <div className="space-y-2" key={key}>
                  <Label htmlFor={`config-${key}`}>
                    {label}
                    {isRequired ? <span className="ml-1 text-red-400">*</span> : null}
                  </Label>
                  <Select
                    value={String(value ?? '')}
                    onValueChange={(nextValue) => {
                      setConfigValues((previous) => ({
                        ...previous,
                        [key]: nextValue,
                      }))
                    }}
                  >
                    <SelectTrigger id={`config-${key}`} className="w-full">
                      <SelectValue placeholder={`Select ${label}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {property.enum.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {hint?.help ? <p className="text-xs text-zinc-400">{hint.help}</p> : null}
                </div>
              )
            }

            return (
              <div className="space-y-2" key={key}>
                <Label htmlFor={`config-${key}`}>
                  {label}
                  {isRequired ? <span className="ml-1 text-red-400">*</span> : null}
                </Label>
                <Input
                  id={`config-${key}`}
                  type={
                    property.type === 'number'
                      ? 'number'
                      : hint?.sensitive
                        ? 'password'
                        : 'text'
                  }
                  value={String(value ?? '')}
                  onChange={(event) => {
                    const rawValue = event.target.value
                    const nextValue =
                      property.type === 'number'
                        ? rawValue.length === 0
                          ? ''
                          : Number.isFinite(Number(rawValue))
                            ? Number(rawValue)
                            : rawValue
                        : rawValue

                    setConfigValues((previous) => ({
                      ...previous,
                      [key]: nextValue,
                    }))
                  }}
                  required={isRequired}
                />
                {hint?.help ? <p className="text-xs text-zinc-400">{hint.help}</p> : null}
              </div>
            )
          })}
        </div>
      ) : null}
      <input type="hidden" name="config" value={configJson} />

      <Button type="submit" className="w-full sm:w-auto">
        Create Pod
      </Button>
    </form>
  )
}
