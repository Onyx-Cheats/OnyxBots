import test from 'node:test'
import assert from 'node:assert/strict'
import { bearerManagementKey, createManagementAccess, hashManagementKey } from '../server/access.mjs'

test('management access keys are high entropy and stored as one-way hashes', () => {
  const first = createManagementAccess()
  const second = createManagementAccess()
  assert.match(first.key, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(first.hash, hashManagementKey(first.key))
  assert.notEqual(first.hash, first.key)
  assert.notEqual(first.hash, second.hash)
  assert.notEqual(first.key, second.key)
})

test('management keys require an exact Bearer header and valid key shape', () => {
  const { key } = createManagementAccess()
  assert.equal(bearerManagementKey(`Bearer ${key}`), key)
  assert.equal(bearerManagementKey(`bearer ${key}`), null)
  assert.equal(bearerManagementKey(`Bearer ${key} `), null)
  assert.equal(bearerManagementKey('Bearer short'), null)
  assert.equal(bearerManagementKey(undefined), null)
  assert.throws(() => hashManagementKey('short'), /invalid_management_key/)
})
