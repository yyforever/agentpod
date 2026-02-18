import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const IV_LENGTH_BYTES = 12
const AUTH_TAG_LENGTH_BYTES = 16
const ENCRYPTION_KEY_HEX_LENGTH = 64

function parseEncryptionKey(key: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      `invalid encryption key: expected ${ENCRYPTION_KEY_HEX_LENGTH} hex characters (32 bytes)`,
    )
  }

  return Buffer.from(key, 'hex')
}

export function encrypt(plaintext: string, key: string): string {
  const parsedKey = parseEncryptionKey(key)
  const iv = randomBytes(IV_LENGTH_BYTES)
  const cipher = createCipheriv('aes-256-gcm', parsedKey, iv)

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `${iv.toString('base64')}:${ciphertext.toString('base64')}:${authTag.toString('base64')}`
}

export function decrypt(encrypted: string, key: string): string {
  const parsedKey = parseEncryptionKey(key)
  const parts = encrypted.split(':')
  if (parts.length !== 3) {
    throw new Error('invalid encrypted value format')
  }

  const [ivPart, ciphertextPart, authTagPart] = parts
  if (!ivPart || !ciphertextPart || !authTagPart) {
    throw new Error('invalid encrypted value format')
  }

  const iv = Buffer.from(ivPart, 'base64')
  const ciphertext = Buffer.from(ciphertextPart, 'base64')
  const authTag = Buffer.from(authTagPart, 'base64')

  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error('invalid encrypted value format')
  }

  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error('invalid encrypted value format')
  }

  const decipher = createDecipheriv('aes-256-gcm', parsedKey, iv)
  decipher.setAuthTag(authTag)

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}

export function isEncrypted(value: string): boolean {
  const parts = value.split(':')
  if (parts.length !== 3) {
    return false
  }

  const [ivPart, ciphertextPart, authTagPart] = parts
  if (!ivPart || !ciphertextPart || !authTagPart) {
    return false
  }

  const iv = Buffer.from(ivPart, 'base64')
  const authTag = Buffer.from(authTagPart, 'base64')
  return iv.length === IV_LENGTH_BYTES && authTag.length === AUTH_TAG_LENGTH_BYTES
}
