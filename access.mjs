import { createHash, randomBytes } from 'node:crypto'

const MANAGEMENT_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function hashManagementKey(key) {
  if (typeof key !== 'string' || !MANAGEMENT_KEY_PATTERN.test(key)) {
    throw new Error('invalid_management_key')
  }
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

export function createManagementAccess() {
  const key = randomBytes(32).toString('base64url')
  return { key, hash: hashManagementKey(key) }
}

export function bearerManagementKey(header) {
  if (typeof header !== 'string') return null
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header)
  return match ? match[1] : null
}
