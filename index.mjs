import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { closePool, getPool } from './database.mjs'
import { runMigrations } from './migrate.mjs'
import {
  decryptBotToken,
  encryptBotToken,
  hashTelegramChat,
  safeEqual,
  telegramWebhookSecret,
  tokenFingerprint,
} from './crypto.mjs'
import { bearerManagementKey, createManagementAccess, hashManagementKey } from './access.mjs'
import { telegramCall } from './telegram.mjs'
import { parseBotCommand, replyForMessage, validateBotConfig, validateBotToken } from './validation.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const staticDirectory = path.resolve(here, '../dist')
let schemaReady = false
let schemaFailed = false
const app = express()
app.disable('x-powered-by')

// Check Telegram's secret header before Express reads or parses the request body.
app.use((req, res, next) => {
  const prefix = '/api/webhooks/telegram/'
  if (!req.path.startsWith(prefix)) return next()
  const botId = req.path.slice(prefix.length)
  if (!/^[0-9a-f-]{36}$/i.test(botId)) return res.status(404).json({ ok: false })
  let expected
  try { expected = telegramWebhookSecret(botId) } catch { return res.status(503).json({ ok: false }) }
  if (!safeEqual(req.get('x-telegram-bot-api-secret-token'), expected)) {
    return res.status(401).json({ ok: false })
  }
  return next()
})
app.use(express.json({ limit: '64kb', strict: true }))
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
const safeBotColumns = `id, owner_open_id, telegram_username, bot_label, description,
  welcome_message, help_message, commands_json, status, total_messages, unique_users,
  last_activity_at, created_at, updated_at`

function parseJson(value, fallback = []) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return fallback
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function publicBot(row) {
  return {
    id: row.id,
    telegramUsername: row.telegram_username,
    name: row.bot_label,
    description: row.description,
    start: row.welcome_message,
    help: row.help_message,
    commands: parseJson(row.commands_json),
    status: row.status,
    totalMessages: Number(row.total_messages || 0),
    uniqueUsers: Number(row.unique_users || 0),
    lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }
}

function publicOrigin(req) {
  if (process.env.NODE_ENV !== 'production') throw new Error('public_origin_required')
  const value = req.get('origin')
  if (!value || value === 'null') throw new Error('public_origin_required')
  let url
  try { url = new URL(value) } catch { throw new Error('public_origin_invalid') }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('public_origin_invalid')
  }
  if (url.protocol !== 'https:') throw new Error('https_required')
  return url.origin
}

function telegramWebhookUrl(origin, botId) {
  return new URL(`/api/webhooks/telegram/${encodeURIComponent(botId)}`, origin).toString()
}

function errorResponse(res, error) {
  const code = error?.message || 'server_error'
  const statusByCode = {
    invalid_bot_configuration: 400,
    invalid_name: 400,
    invalid_description: 400,
    invalid_start_message: 400,
    invalid_help_message: 400,
    invalid_commands: 400,
    invalid_command: 400,
    invalid_command_name: 400,
    invalid_command_response: 400,
    invalid_bot_token: 400,
    public_origin_required: 400,
    public_origin_invalid: 400,
    https_required: 400,
    bot_not_found: 404,
    bot_update_busy: 503,
    bot_access_required: 401,
    bot_access_invalid: 401,
    bot_token_encryption_key_missing: 503,
    bot_token_encryption_key_invalid: 503,
    telegram_request_failed: 502,
    database_url_missing: 503,
    database_url_invalid: 503,
  }
  const messageByCode = {
    invalid_bot_configuration: 'Check the bot fields and try again.',
    invalid_name: 'Add a bot name of 120 characters or fewer.',
    invalid_description: 'Keep the description to 120 characters or fewer.',
    invalid_start_message: 'The /start message must be 1–4096 characters.',
    invalid_help_message: 'The /help message must be 1–4096 characters.',
    invalid_commands: 'Use no more than 40 custom commands.',
    invalid_command: 'Check the custom command details and try again.',
    invalid_command_name: 'Use unique command names containing letters, numbers, or underscores.',
    invalid_command_response: 'Each command response must be 1–4096 characters.',
    invalid_bot_token: 'That token format is not valid. Check the token from @BotFather.',
    public_origin_required: 'Open the published website to connect or change a bot.',
    public_origin_invalid: 'The website origin could not be validated.',
    https_required: 'Telegram bot webhooks require a secure HTTPS website.',
    bot_not_found: 'No ONYX bot matches that token. Check the BotFather token and try again.',
    bot_update_busy: 'This bot is being updated. Wait a moment, then try again.',
    bot_access_required: 'Open this bot’s private management link to continue.',
    bot_access_invalid: 'This management link is invalid or has been rotated. Open the latest link or recover access with the BotFather token.',
    bot_token_encryption_key_missing: 'Secure bot storage is not configured yet.',
    bot_token_encryption_key_invalid: 'Secure bot storage configuration is invalid.',
    telegram_request_failed: 'Telegram could not complete that request. Check the token and try again.',
    server_error: 'The server could not complete that request. Try again shortly.',
  }
  return res.status(statusByCode[code] || 500).json({ error: messageByCode[code] || 'The server could not complete that request.' })
}

async function getOwnedBot(pool, botId, ownerOpenId) {
  const [rows] = await pool.execute(
    `SELECT ${safeBotColumns}, token_ciphertext, token_iv, token_tag, token_fingerprint
     FROM onyx_bots WHERE id = ? AND owner_open_id = ? LIMIT 1`,
    [botId, ownerOpenId],
  )
  if (!rows[0]) throw new Error('bot_not_found')
  return rows[0]
}

async function requireBotAccess(req, res, next) {
  try {
    const key = bearerManagementKey(req.get('authorization'))
    if (!key) return res.status(401).json({ error: 'bot_access_required' })
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id || '')) {
      return res.status(401).json({ error: 'bot_access_invalid' })
    }
    const keyHash = hashManagementKey(key)
    const [rows] = await getPool().execute(
      `SELECT b.id, b.owner_open_id
       FROM onyx_bots AS b
       JOIN onyx_bot_access_keys AS a ON a.bot_id = b.id
       WHERE b.id = ? AND a.key_hash = ? LIMIT 1`,
      [req.params.id, keyHash],
    )
    if (!rows[0]) return res.status(401).json({ error: 'bot_access_invalid' })
    req.botAccess = { botId: rows[0].id, ownerOpenId: rows[0].owner_open_id }
    return next()
  } catch {
    return res.status(503).json({ error: 'service_unavailable' })
  }
}

async function saveBotConfig(pool, botId, ownerOpenId, config) {
  const [result] = await pool.execute(
    `UPDATE onyx_bots
     SET bot_label = ?, description = ?, welcome_message = ?, help_message = ?,
         commands_json = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND owner_open_id = ?`,
    [config.name, config.description, config.start, config.help,
      JSON.stringify(config.commands), botId, ownerOpenId],
  )
  if (!result.affectedRows) throw new Error('bot_not_found')
  return getOwnedBot(pool, botId, ownerOpenId)
}

async function registerTelegramWebhook(pool, bot) {
  const token = decryptBotToken(bot)
  const secret = telegramWebhookSecret(bot.id)
  await telegramCall(token, 'setWebhook', {
    url: telegramWebhookUrl(bot.public_origin, bot.id),
    secret_token: secret,
    allowed_updates: ['message'],
    drop_pending_updates: false,
  })
  await pool.execute(
    `UPDATE onyx_bots SET status = 'active', updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND owner_open_id = ?`,
    [bot.id, bot.owner_open_id],
  )
}

async function installAccessKey(pool, botId, keyHash) {
  await pool.execute(
    `INSERT INTO onyx_bot_access_keys (bot_id, key_hash)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE key_hash = VALUES(key_hash), updated_at = CURRENT_TIMESTAMP(3)`,
    [botId, keyHash],
  )
}

async function upsertBotRecord(pool, { config, token, fingerprint, telegramUsername }) {
  const access = createManagementAccess()
  const connection = await pool.getConnection()
  const lockName = `onyx-token-${fingerprint.slice(0, 51)}`
  let locked = false
  let botId
  let ownerOpenId
  let updated = false

  try {
    const [lockRows] = await connection.query('SELECT GET_LOCK(?, 15) AS acquired', [lockName])
    if (Number(lockRows[0]?.acquired) !== 1) throw new Error('bot_update_busy')
    locked = true
    await connection.beginTransaction()
    const [rows] = await connection.execute(
      `SELECT ${safeBotColumns}, token_ciphertext, token_iv, token_tag, token_fingerprint
       FROM onyx_bots WHERE token_fingerprint = ? LIMIT 1 FOR UPDATE`,
      [fingerprint],
    )
    const existing = rows[0]

    if (existing) {
      const storedToken = decryptBotToken(existing)
      if (!safeEqual(storedToken, token)) throw new Error('bot_not_found')
      botId = existing.id
      ownerOpenId = existing.owner_open_id
      updated = true
    } else {
      botId = randomUUID()
      ownerOpenId = `bot-link:${botId}`
      await connection.execute(
        'INSERT INTO onyx_users (open_id, display_name) VALUES (?, ?)',
        [ownerOpenId, 'Link-managed bot'],
      )
    }

    const encrypted = encryptBotToken(token, { botId, ownerOpenId })
    if (existing) {
      await connection.execute(
        `UPDATE onyx_bots
         SET telegram_username = ?, bot_label = ?, description = ?, welcome_message = ?,
             help_message = ?, commands_json = ?, token_fingerprint = ?, token_ciphertext = ?,
             token_iv = ?, token_tag = ?, status = 'provisioning', updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND owner_open_id = ?`,
        [telegramUsername, config.name, config.description, config.start, config.help,
          JSON.stringify(config.commands), fingerprint, encrypted.ciphertext, encrypted.iv,
          encrypted.tag, botId, ownerOpenId],
      )
    } else {
      await connection.execute(
        `INSERT INTO onyx_bots
         (id, owner_open_id, telegram_username, bot_label, description, welcome_message,
          help_message, commands_json, status, token_fingerprint, token_ciphertext, token_iv, token_tag)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'provisioning', ?, ?, ?, ?)`,
        [botId, ownerOpenId, telegramUsername, config.name, config.description,
          config.start, config.help, JSON.stringify(config.commands), fingerprint,
          encrypted.ciphertext, encrypted.iv, encrypted.tag],
      )
    }
    await connection.execute(
      `INSERT INTO onyx_bot_access_keys (bot_id, key_hash) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE key_hash = VALUES(key_hash), updated_at = CURRENT_TIMESTAMP(3)`,
      [botId, access.hash],
    )
    await connection.commit()
    return { botId, ownerOpenId, accessKey: access.key, updated }
  } catch (error) {
    await connection.rollback().catch(() => {})
    throw error
  } finally {
    if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {})
    connection.release()
  }
}

async function health(_req, res) {
  if (!schemaReady) {
    return res.status(503).json({
      ok: false,
      service: 'onyx-telegram-bot-server',
      state: schemaFailed ? 'migration_failed' : 'initializing',
    })
  }
  try {
    await getPool().query('SELECT 1 AS ok')
    return res.status(200).json({ ok: true, service: 'onyx-telegram-bot-server' })
  } catch {
    return res.status(503).json({ ok: false, service: 'onyx-telegram-bot-server' })
  }
}

app.get('/_app/health', health)
app.get('/api/health', health)
app.use('/api', (_req, res, next) => {
  if (schemaReady) return next()
  return res.status(503).json({ error: schemaFailed ? 'service_unavailable' : 'service_initializing' })
})

app.get('/api/bots/:id', requireBotAccess, asyncRoute(async (req, res) => {
  const bot = await getOwnedBot(getPool(), req.botAccess.botId, req.botAccess.ownerOpenId)
  return res.json({ bot: publicBot(bot) })
}))

app.post('/api/bots', asyncRoute(async (req, res) => {
  const origin = publicOrigin(req)
  const config = validateBotConfig(req.body)
  const token = validateBotToken(req.body.token)
  const me = await telegramCall(token, 'getMe')
  if (!me?.is_bot || typeof me.username !== 'string') throw new Error('telegram_request_failed')

  const pool = getPool()
  const saved = await upsertBotRecord(pool, {
    config,
    token,
    fingerprint: tokenFingerprint(token),
    telegramUsername: me.username,
  })
  let warning = null
  const bot = await getOwnedBot(pool, saved.botId, saved.ownerOpenId)
  try {
    await registerTelegramWebhook(pool, { ...bot, public_origin: origin })
  } catch {
    warning = 'telegram_request_failed'
    await pool.execute(
      `UPDATE onyx_bots SET status = 'error', updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [saved.botId],
    )
  }
  return res.status(saved.updated ? 200 : 201).json({
    bot: publicBot(await getOwnedBot(pool, saved.botId, saved.ownerOpenId)),
    accessKey: saved.accessKey,
    warning,
    updated: saved.updated,
  })
}))

app.put('/api/bots/:id', requireBotAccess, asyncRoute(async (req, res) => {
  publicOrigin(req)
  const config = validateBotConfig(req.body)
  const bot = await saveBotConfig(getPool(), req.botAccess.botId, req.botAccess.ownerOpenId, config)
  return res.json({ bot: publicBot(bot) })
}))

app.post('/api/bots/:id/deploy', requireBotAccess, asyncRoute(async (req, res) => {
  const origin = publicOrigin(req)
  const pool = getPool()
  const bot = await getOwnedBot(pool, req.botAccess.botId, req.botAccess.ownerOpenId)
  try {
    const token = decryptBotToken(bot)
    const me = await telegramCall(token, 'getMe')
    if (!me?.is_bot || typeof me.username !== 'string') throw new Error('telegram_request_failed')
    await registerTelegramWebhook(pool, { ...bot, telegram_username: me.username, public_origin: origin })
    await pool.execute(
      'UPDATE onyx_bots SET telegram_username = ? WHERE id = ? AND owner_open_id = ?',
      [me.username, bot.id, req.botAccess.ownerOpenId],
    )
  } catch (error) {
    await pool.execute(
      `UPDATE onyx_bots SET status = 'error', updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND owner_open_id = ?`,
      [bot.id, req.botAccess.ownerOpenId],
    )
    if (error?.message === 'bot_token_encryption_key_missing' || error?.message === 'bot_token_encryption_key_invalid') throw error
    throw new Error('telegram_request_failed')
  }
  return res.json({ bot: publicBot(await getOwnedBot(pool, bot.id, req.botAccess.ownerOpenId)) })
}))

app.post('/api/bots/:id/access/rotate', requireBotAccess, asyncRoute(async (req, res) => {
  publicOrigin(req)
  const access = createManagementAccess()
  await installAccessKey(getPool(), req.botAccess.botId, access.hash)
  return res.json({ accessKey: access.key })
}))

app.post('/api/access/recover', asyncRoute(async (req, res) => {
  publicOrigin(req)
  const token = validateBotToken(req.body?.token)
  const me = await telegramCall(token, 'getMe')
  if (!me?.is_bot || typeof me.username !== 'string') throw new Error('telegram_request_failed')
  const fingerprint = tokenFingerprint(token)
  const [rows] = await getPool().execute(
    `SELECT ${safeBotColumns}, token_ciphertext, token_iv, token_tag, token_fingerprint
     FROM onyx_bots WHERE token_fingerprint = ? LIMIT 1`,
    [fingerprint],
  )
  const bot = rows[0]
  if (!bot) throw new Error('bot_not_found')
  const storedToken = decryptBotToken(bot)
  if (!safeEqual(storedToken, token)) throw new Error('bot_not_found')
  const access = createManagementAccess()
  await installAccessKey(getPool(), bot.id, access.hash)
  return res.json({ bot: publicBot(bot), accessKey: access.key })
}))

app.get('/api/bots/:id/analytics', requireBotAccess, asyncRoute(async (req, res) => {
  const pool = getPool()
  const [rows] = await pool.execute(
    `SELECT total_messages, unique_users, last_activity_at
     FROM onyx_bots WHERE id = ? AND owner_open_id = ? LIMIT 1`,
    [req.botAccess.botId, req.botAccess.ownerOpenId],
  )
  const [activityRows] = await pool.execute(
    `SELECT DATE_FORMAT(activity_date, '%x-W%v') AS week, SUM(message_count) AS messages
     FROM onyx_bot_activity
     WHERE bot_id = ? AND activity_date >= DATE_SUB(UTC_DATE(), INTERVAL 83 DAY)
     GROUP BY DATE_FORMAT(activity_date, '%x-W%v')
     ORDER BY MIN(activity_date)`,
    [req.botAccess.botId],
  )
  const row = rows[0] || {}
  return res.json({
    bots: row.total_messages === undefined ? 0 : 1,
    messages: Number(row.total_messages || 0),
    users: Number(row.unique_users || 0),
    lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at).toISOString() : null,
    activity: activityRows.map((week) => ({ week: week.week, messages: Number(week.messages || 0) })),
  })
}))

app.delete('/api/bots/:id', requireBotAccess, asyncRoute(async (req, res) => {
  publicOrigin(req)
  const pool = getPool()
  const bot = await getOwnedBot(pool, req.botAccess.botId, req.botAccess.ownerOpenId)
  const token = decryptBotToken(bot)
  await telegramCall(token, 'deleteWebhook', { drop_pending_updates: false })
  await pool.execute('DELETE FROM onyx_bots WHERE id = ? AND owner_open_id = ?', [bot.id, req.botAccess.ownerOpenId])
  await pool.execute('DELETE FROM onyx_users WHERE open_id = ?', [req.botAccess.ownerOpenId])
  return res.json({ ok: true })
}))

app.post('/api/webhooks/telegram/:botId', asyncRoute(async (req, res) => {
  const botId = req.params.botId
  if (!/^[0-9a-f-]{36}$/i.test(botId)) return res.status(404).json({ ok: false })
  let expected
  try { expected = telegramWebhookSecret(botId) } catch { return res.status(503).json({ ok: false }) }
  if (!safeEqual(req.get('x-telegram-bot-api-secret-token'), expected)) {
    return res.status(401).json({ ok: false })
  }

  const pool = getPool()
  const [rows] = await pool.execute(
    `SELECT ${safeBotColumns}, token_ciphertext, token_iv, token_tag
     FROM onyx_bots WHERE id = ? LIMIT 1`,
    [botId],
  )
  const bot = rows[0]
  if (!bot || bot.status !== 'active') return res.status(200).json({ ok: true })
  const updateId = req.body?.update_id
  if (!Number.isSafeInteger(Number(updateId)) || Number(updateId) < 0) {
    return res.status(200).json({ ok: true })
  }

  const [inserted] = await pool.execute(
    `INSERT IGNORE INTO onyx_bot_updates (bot_id, update_id, state, received_at)
     VALUES (?, ?, 'processing', CURRENT_TIMESTAMP(3))`,
    [botId, String(updateId)],
  )
  if (!inserted.affectedRows) {
    const [existing] = await pool.execute(
      'SELECT state, received_at FROM onyx_bot_updates WHERE bot_id = ? AND update_id = ? LIMIT 1',
      [botId, String(updateId)],
    )
    const prior = existing[0]
    if (prior?.state === 'done') return res.status(200).json({ ok: true })
    const ageMs = prior?.received_at ? Date.now() - new Date(prior.received_at).getTime() : 0
    if (prior?.state === 'processing' && ageMs >= 0 && ageMs < 60_000) {
      return res.status(503).json({ ok: false })
    }
    await pool.execute(
      `UPDATE onyx_bot_updates SET state = 'processing', received_at = CURRENT_TIMESTAMP(3)
       WHERE bot_id = ? AND update_id = ?`,
      [botId, String(updateId)],
    )
  }

  try {
    const message = req.body.message || req.body.edited_message
    if (message?.chat?.id !== undefined) {
      const command = parseBotCommand(message, bot.telegram_username)
      const eventType = command?.name === 'start' ? 'start' : 'message'
      const connection = await pool.getConnection()
      try {
        await connection.beginTransaction()
        const chatHash = hashTelegramChat(botId, message.chat.id)
        const [chatResult] = await connection.execute(
          'INSERT IGNORE INTO onyx_bot_chats (bot_id, chat_hash) VALUES (?, ?)',
          [botId, chatHash],
        )
        const [eventResult] = await connection.execute(
          `INSERT IGNORE INTO onyx_bot_message_events (bot_id, update_id, event_type, occurred_at)
           VALUES (?, ?, ?, UTC_TIMESTAMP(3))`,
          [botId, String(updateId), eventType],
        )
        if (eventResult.affectedRows) {
          const newChat = chatResult.affectedRows ? 1 : 0
          const activityDate = new Date().toISOString().slice(0, 10)
          await connection.execute(
            `UPDATE onyx_bots SET total_messages = total_messages + 1,
             unique_users = unique_users + ?, last_activity_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
            [newChat, botId],
          )
          await connection.execute(
            `INSERT INTO onyx_bot_activity (bot_id, activity_date, message_count, new_users)
             VALUES (?, ?, 1, ?)
             ON DUPLICATE KEY UPDATE message_count = message_count + 1,
               new_users = new_users + VALUES(new_users)`,
            [botId, activityDate, newChat],
          )
        }
        await connection.commit()
      } catch (error) {
        await connection.rollback().catch(() => {})
        throw error
      } finally {
        connection.release()
      }

      if (Number(updateId) % 100 === 0) {
        await pool.execute(
          `DELETE FROM onyx_bot_message_events
           WHERE bot_id = ? AND occurred_at < UTC_TIMESTAMP(3) - INTERVAL 8 DAY`,
          [botId],
        )
      }

      let reply = null
      if (command) {
        const [countRows] = await pool.execute(
          `SELECT
             (SELECT COUNT(*) FROM onyx_bot_message_events
              WHERE bot_id = ? AND event_type = 'start'
                AND occurred_at >= UTC_TIMESTAMP(3) - INTERVAL 1 DAY) AS total_starts,
             (SELECT COUNT(*) FROM onyx_bot_message_events
              WHERE bot_id = ? AND occurred_at >= UTC_TIMESTAMP(3) - INTERVAL 1 DAY) AS total_messages,
             (SELECT COUNT(*) FROM onyx_bot_chats WHERE bot_id = ?) AS total_chats`,
          [botId, botId, botId],
        )
        const counts = countRows[0] || {}
        reply = replyForMessage(message, bot, bot.telegram_username, {
          totalStarts: Number(counts.total_starts || 0),
          totalMessages: Number(counts.total_messages || 0),
          totalChats: Number(counts.total_chats || 0),
        })
      }
      if (reply) {
        const token = decryptBotToken(bot)
        await telegramCall(token, 'sendMessage', { chat_id: message.chat.id, text: reply })
      }
    }
    await pool.execute(
      `UPDATE onyx_bot_updates SET state = 'done', received_at = CURRENT_TIMESTAMP(3)
       WHERE bot_id = ? AND update_id = ?`,
      [botId, String(updateId)],
    )
    return res.status(200).json({ ok: true })
  } catch {
    await pool.execute(
      `UPDATE onyx_bot_updates SET state = 'failed', received_at = CURRENT_TIMESTAMP(3)
       WHERE bot_id = ? AND update_id = ?`,
      [botId, String(updateId)],
    )
    return res.status(503).json({ ok: false })
  }
}))

// Published routing normally serves the frontend from static output. These
// handlers also serve it when a request reaches the container directly.
app.use(express.static(staticDirectory, { index: false, fallthrough: true }))
app.get('/', (_req, res, next) => res.sendFile(path.join(staticDirectory, 'index.html'), (error) => error && next(error)))
app.use((req, res, next) => {
  if (req.method === 'GET' && req.path !== '/api' && !req.path.startsWith('/api/') && !path.extname(req.path)) {
    return res.sendFile(path.join(staticDirectory, 'index.html'), (error) => error && next(error))
  }
  return next()
})
app.use((_req, res) => res.status(404).json({ error: 'not_found' }))
app.use((error, _req, res, _next) => {
  if (res.headersSent) return
  return errorResponse(res, error)
})

const isProduction = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT) || (isProduction ? 3000 : 3001)
let shuttingDown = false
let retryTimer

async function initializeSchema() {
  let delayMs = 1000
  while (!shuttingDown) {
    try {
      await runMigrations({ closeWhenDone: false })
      schemaReady = true
      schemaFailed = false
      console.log('ONYX database schema is ready.')
      return
    } catch {
      schemaFailed = true
      if (shuttingDown) return
      console.error(`Database initialization failed; retrying in ${delayMs} ms.`)
      await new Promise((resolve) => { retryTimer = setTimeout(resolve, delayMs) })
      delayMs = Math.min(delayMs * 2, 30_000)
    }
  }
}

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`ONYX Telegram API listening on port ${port}`)
  void initializeSchema()
})

async function shutdown() {
  shuttingDown = true
  if (retryTimer) clearTimeout(retryTimer)
  server.close(async () => {
    try { await closePool() } finally { process.exit(0) }
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
