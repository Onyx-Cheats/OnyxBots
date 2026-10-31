import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

const KEY_PATTERN = /^[a-f0-9]{64}$/i

function encryptionKey() {
  const configured = process.env.BOT_TOKEN_ENCRYPTION_KEY
  if (!configured) throw new Error('bot_token_encryption_key_missing')
  if (!KEY_PATTERN.test(configured)) throw new Error('bot_token_encryption_key_invalid')
  return Buffer.from(configured, 'hex')
}

function tokenAssociatedData(botId, ownerOpenId) {
  if (typeof botId !== 'string' || !botId || typeof ownerOpenId !== 'string' || !ownerOpenId) {
    throw new Error('bot_token_context_invalid')
  }
  return Buffer.from(`onyx:bot-token:v1:${botId}:${ownerOpenId}`, 'utf8')
}

export function encryptBotToken(token, { botId, ownerOpenId }) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  cipher.setAAD(tokenAssociatedData(botId, ownerOpenId))
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

export function decryptBotToken(record) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(record.token_iv, 'base64'),
  )
  decipher.setAAD(tokenAssociatedData(record.id, record.owner_open_id))
  decipher.setAuthTag(Buffer.from(record.token_tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(record.token_ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

export function tokenFingerprint(token) {
  return createHmac('sha256', encryptionKey()).update(`bot-token:${token}`).digest('hex')
}

export function telegramWebhookSecret(botId) {
  return createHmac('sha256', encryptionKey()).update(`telegram-webhook:${botId}`).digest('hex')
}

export function hashTelegramChat(botId, chatId) {
  return createHmac('sha256', encryptionKey())
    .update(`telegram-chat:${botId}:${String(chatId)}`)
    .digest('hex')
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}
