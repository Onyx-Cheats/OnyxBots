import test from 'node:test'
import assert from 'node:assert/strict'
import { decryptBotToken, encryptBotToken, safeEqual, telegramWebhookSecret } from '../server/crypto.mjs'
import { commandVariables } from '../shared/command-variables.mjs'
import { parseBotCommand, replyForMessage, validateBotConfig, validateBotToken } from '../server/validation.mjs'

const previousKey = process.env.BOT_TOKEN_ENCRYPTION_KEY
process.env.BOT_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64)

const context = { botId: 'bot-one', ownerOpenId: 'owner-one' }
const recordFrom = (encrypted, overrides = {}) => ({
  id: context.botId,
  owner_open_id: context.ownerOpenId,
  token_ciphertext: encrypted.ciphertext,
  token_iv: encrypted.iv,
  token_tag: encrypted.tag,
  ...overrides,
})

const fixedNow = new Date('2026-10-31T12:34:56.000Z')
const botRow = (overrides = {}) => ({
  bot_label: 'ONYX Helper',
  telegram_username: 'OnyxHelperBot',
  welcome_message: 'Welcome #username$!',
  help_message: 'Use /hello.',
  commands_json: [{ name: '/hello', response: 'Hello #firstname$.' }],
  ...overrides,
})

const senderMessage = (text, overrides = {}) => ({
  text,
  message_id: 99,
  from: { id: 42, username: 'alice', first_name: 'Alice', last_name: 'Smith', language_code: 'en', is_bot: false },
  chat: { id: 77, type: 'private' },
  ...overrides,
})

test('encrypts bot tokens with randomized authenticated ciphertext bound to bot and owner', () => {
  const token = '123456:abcdefghijklmnopqrstuvwxyz012345'
  const first = encryptBotToken(token, context)
  const second = encryptBotToken(token, context)
  assert.notEqual(first.ciphertext, second.ciphertext)
  assert.equal(decryptBotToken(recordFrom(first)), token)
  assert.throws(() => decryptBotToken(recordFrom(first, { id: 'bot-two' })), /authenticate/)
  assert.throws(() => decryptBotToken(recordFrom(first, { owner_open_id: 'owner-two' })), /authenticate/)
})

test('derives per-bot webhook secrets and compares them safely', () => {
  const first = telegramWebhookSecret('bot-one')
  const second = telegramWebhookSecret('bot-two')
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.notEqual(first, second)
  assert.equal(safeEqual(first, first), true)
  assert.equal(safeEqual(first, second), false)
})

test('validates BotFather token shape without echoing it', () => {
  assert.equal(validateBotToken('123456:abcdefghijklmnopqrstuvwxyz012345'), '123456:abcdefghijklmnopqrstuvwxyz012345')
  assert.throws(() => validateBotToken('not-a-token'), /invalid_bot_token/)
})

test('normalizes configured commands and parses bot-targeted commands and arguments', () => {
  const config = validateBotConfig({
    name: 'ONYX Bot', description: '', start: 'Welcome', help: 'Help',
    commands: [{ id: 3, name: '/rules', response: 'Be kind.' }],
  })
  const row = { welcome_message: config.start, help_message: config.help, commands_json: config.commands }
  assert.equal(replyForMessage(senderMessage('/start'), row, 'OnyxBot', { now: fixedNow }), 'Welcome\n\nMADE WITH @onyxbotsofficial')
  assert.equal(replyForMessage(senderMessage('/rules@OnyxBot'), row, 'OnyxBot', { now: fixedNow }), 'Be kind.')
  assert.equal(replyForMessage(senderMessage('/rules@OtherBot'), row, 'OnyxBot'), null)
  assert.equal(replyForMessage(senderMessage('hello'), row), null)
  assert.deepEqual(parseBotCommand(senderMessage('/echo hello there'), 'OnyxBot'), { name: 'echo', input: 'hello there' })
})

test('always appends one immutable brand footer to the editable /start message', () => {
  const reply = replyForMessage(
    senderMessage('/start', { from: { first_name: 'Rae' } }),
    botRow({ welcome_message: 'Hi #username$\n\nMADE WITH @onyxbotsofficial' }),
    'OnyxHelperBot',
    { now: fixedNow },
  )
  assert.equal(reply, 'Hi Rae\n\nMADE WITH @onyxbotsofficial')
})

test('expands every listed placeholder, including exact rolling counters and command input', () => {
  const response = commandVariables.map(({ token }) => token).join('|')
  const config = botRow({ commands_json: [{ name: '/inspect', response }] })
  const reply = replyForMessage(senderMessage('/inspect hello world', {
    from: { id: 42, username: 'alice', first_name: 'Alice', last_name: 'Smith', language_code: 'en', is_bot: false },
    chat: { id: 77, type: 'supergroup', title: 'Builders' },
    message_id: 99,
  }), config, 'OnyxHelperBot', { totalStarts: 12, totalMessages: 45, totalChats: 8, now: fixedNow })
  assert.equal(reply.includes('#'), false)
  assert.match(reply, /@alice\|Alice\|Smith\|42\|77\|Builders\|Builders\|en\|false\|\/inspect\|hello world\|99/)
  assert.match(reply, /ONYX Helper\|@OnyxHelperBot\|2026-10-31\|12:34:56\|2026-10-31T12:34:56\.000Z\|12\|45\|8$/)
})

test.after(() => {
  if (previousKey === undefined) delete process.env.BOT_TOKEN_ENCRYPTION_KEY
  else process.env.BOT_TOKEN_ENCRYPTION_KEY = previousKey
})
