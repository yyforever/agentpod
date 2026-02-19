'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { auth } from '@/auth'
import {
  ApiRequestError,
  createPod,
  createTenant,
  deletePod,
  deleteTenant,
  startPod,
  stopPod,
  updateTenant,
} from '@/lib/api'

const createTenantSchema = z.object({
  name: z.string().trim().min(1),
  email: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
})

const createPodSchema = z.object({
  tenantId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  adapterId: z.string().trim().min(1),
  configText: z.string().trim().default('{}'),
})

const configSchema = z.record(z.unknown())

async function requireSession(): Promise<void> {
  const session = await auth()
  if (!session?.user) {
    redirect('/')
  }
}

export async function createTenantAction(formData: FormData): Promise<void> {
  await requireSession()

  const parsed = createTenantSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
  })

  if (!parsed.success) {
    redirect('/dashboard/tenants?error=invalid_input')
  }

  await createTenant({
    name: parsed.data.name,
    email: parsed.data.email,
  })

  revalidatePath('/dashboard/tenants')
  redirect('/dashboard/tenants')
}

export async function updateTenantAction(id: string, formData: FormData): Promise<void> {
  await requireSession()

  const parsed = createTenantSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
  })

  if (!parsed.success) {
    redirect('/dashboard/tenants?error=invalid_tenant_input')
  }

  await updateTenant(id, {
    name: parsed.data.name,
    email: parsed.data.email,
  })

  revalidatePath('/dashboard/tenants')
  redirect('/dashboard/tenants')
}

export async function deleteTenantAction(id: string): Promise<void> {
  await requireSession()

  try {
    await deleteTenant(id)
  } catch (error) {
    if (error instanceof ApiRequestError && (error.code === 'CONFLICT' || error.status === 409)) {
      redirect('/dashboard/tenants?error=tenant_has_pods')
    }
    throw error
  }

  revalidatePath('/dashboard/tenants')
  redirect('/dashboard/tenants')
}

export async function createPodAction(formData: FormData): Promise<void> {
  await requireSession()

  const parsed = createPodSchema.safeParse({
    tenantId: formData.get('tenantId'),
    name: formData.get('name'),
    adapterId: formData.get('adapterId'),
    configText: formData.get('config'),
  })

  if (!parsed.success) {
    redirect('/dashboard/pods/new?error=invalid_input')
  }

  let config: Record<string, unknown> | undefined
  if (parsed.data.configText.length > 0) {
    try {
      const parsedJson: unknown = JSON.parse(parsed.data.configText)
      config = configSchema.parse(parsedJson)
    } catch {
      redirect('/dashboard/pods/new?error=invalid_config_json')
    }
  }

  await createPod({
    tenantId: parsed.data.tenantId,
    name: parsed.data.name,
    adapterId: parsed.data.adapterId,
    config,
  })

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/pods')
  redirect('/dashboard/pods')
}

export async function startPodAction(id: string, returnTo?: string): Promise<void> {
  await requireSession()

  await startPod(id)

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/pods')
  revalidatePath(`/dashboard/pods/${id}`)
  redirect(returnTo ?? '/dashboard/pods')
}

export async function stopPodAction(id: string, returnTo?: string): Promise<void> {
  await requireSession()

  await stopPod(id)

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/pods')
  revalidatePath(`/dashboard/pods/${id}`)
  redirect(returnTo ?? '/dashboard/pods')
}

export async function deletePodAction(id: string, returnTo?: string): Promise<void> {
  await requireSession()

  await deletePod(id)

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/pods')
  redirect(returnTo ?? '/dashboard/pods')
}
