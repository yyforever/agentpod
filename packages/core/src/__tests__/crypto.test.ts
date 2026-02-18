import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { decrypt, encrypt, isEncrypted } from '../crypto.js'

test('encrypt/decrypt roundtrip', () => {
  const key = randomBytes(32).toString('hex')
  const plaintext = 'gateway-token-secret'

  const encrypted = encrypt(plaintext, key)
  assert.ok(isEncrypted(encrypted))

  const decrypted = decrypt(encrypted, key)
  assert.equal(decrypted, plaintext)
})

test('encrypt rejects invalid key length/format', () => {
  assert.throws(
    () => {
      encrypt('plaintext', 'not-a-valid-key')
    },
    /invalid encryption key/,
  )
})

test('decrypt rejects tampered ciphertext', () => {
  const key = randomBytes(32).toString('hex')
  const encrypted = encrypt('sensitive-value', key)
  const [iv, ciphertext, tag] = encrypted.split(':')

  assert.ok(iv)
  assert.ok(ciphertext)
  assert.ok(tag)

  const first = ciphertext[0] === 'A' ? 'B' : 'A'
  const tampered = `${iv}:${first}${ciphertext.slice(1)}:${tag}`

  assert.throws(() => {
    decrypt(tampered, key)
  })
})
