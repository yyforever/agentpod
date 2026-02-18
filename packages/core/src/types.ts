import type { DbClient } from './db/index.js'

export type DrizzleDB = DbClient

export type ReconcileResult = {
  total: number
  success: number
  failed: number
  errors: Array<{ podId: string; message: string }>
}

export * from '@agentpod/shared'
