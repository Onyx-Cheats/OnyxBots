import { commandVariables } from '../shared/command-variables.mjs'

const TOKEN_PATTERN = /^[0-9]+:[A-Za-z0-9_-]{20,200}$/
const COMMAND_PATTERN = /^[a-z0-9_]{1,32}$/i
export const START_BRAND_FOOTER = 'MADE WITH @onyxbotsofficial'
const TEMPLATE_KEYS = new Set(commandVariables.map(({ token }) => token.slice(1, -1)))

function textField(value, field, limit, { required = false } = {}) {
  if (typeof value !== 'string') throw new Error(`invalid_${field}`)
  const result = value.trim()
  if (required && !result) throw new Error(`invalid_${field}`)
  if (result.length > limit) throw new Error(`invalid_${field}`)
  return result
}

export function validateBotToken(value) {
  if (typeof value !== 'string' || value.length > 256 || !TOKEN_PATTERN.test(value.trim())) {
    throw new Error('invalid_bot_token')
  }
  return value.trim()
}

export function validateBotConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_bot_configuration')
  }
  const name = textField(value.name, 'name', 120, { required: true })
  const description = textField(value.description ?? '', 'description', 120)
  const start = textField(value.start, 'start_message', 4096, { required: true })
  const help = textField(value.help, 'help_message', 4096, { required: true })
  const incoming = value.commands ?? []
  if (!Array.isArray(incoming) || incoming.length > 40) throw new Error('invalid_commands')

  const seen = new Set()
  const commands = incoming.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid_command')
    const name = textField(item.name, 'command_name', 33, { required: true }).replace(/^\//, '').toLowerCase()
    if (!COMMAND_PATTERN.test(name) || seen.has(name)) throw new Error('invalid_command_name')
    seen.add(name)
    const response = textField(item.response, 'command_response', 4096, { required: true })
    return { name: `/${name}`, response }
  })

  return { name, description, start, help, commands }
}

export function parseBotCommand(message, botUsername = '') {
  if (typeof message?.text !== 'string' || !message.chat?.id) return null
  const match = message.text.trim().match(/^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?(?:\s+([\s\S]*))?$/i)
  if (!match) return null
  if (match[2] && botUsername && match[2].toLowerCase() !== botUsername.toLowerCase()) return null
  return { name: match[1].toLowerCase(), input: (match[3] || '').trim() }
}

function truncateTelegramText(value, limit = 4096) {
  const characters = Array.from(String(value))
  return characters.length <= limit ? characters.join('') : characters.slice(0, limit).join('')
}

export function renderTemplate(template, values = {}) {
  return String(template).replace(/#([a-z]+)\$/gi, (token, name) => {
    const key = name.toLowerCase()
    if (!TEMPLATE_KEYS.has(key) || values[key] === undefined || values[key] === null) return token
    return String(values[key])
  })
}

function appendFixedStartFooter(text) {
  const withoutTrailingBrand = String(text)
    .replace(/(?:\r?\n){1,2}MADE WITH @onyxbotsofficial\s*$/i, '')
    .trimEnd()
  const suffix = `\n\n${START_BRAND_FOOTER}`
  const bodyLimit = 4096 - Array.from(suffix).length
  const body = truncateTelegramText(withoutTrailingBrand, bodyLimit).trimEnd()
  return body ? `${body}${suffix}` : START_BRAND_FOOTER
}

export function replyForMessage(message, config, botUsername = '', stats = {}) {
  const parsed = parseBotCommand(message, botUsername)
  if (!parsed) return null

  let response = null
  if (parsed.name === 'start') response = config.welcome_message
  else if (parsed.name === 'help') response = config.help_message
  else {
    const commands = Array.isArray(config.commands_json) ? config.commands_json : []
    const custom = commands.find((item) => item.name?.replace(/^\//, '').toLowerCase() === parsed.name)
    response = custom?.response ?? null
  }
  if (typeof response !== 'string') return null

  const from = message.from || {}
  const chat = message.chat || {}
  const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ')
  const groupChat = ['group', 'supergroup', 'channel'].includes(chat.type)
  const now = stats.now instanceof Date ? stats.now : new Date()
  const iso = now.toISOString()
  const values = {
    username: from.username ? `@${from.username}` : (from.first_name || 'there'),
    firstname: from.first_name || '',
    lastname: from.last_name || '',
    userid: from.id === undefined ? '' : String(from.id),
    chatid: chat.id === undefined ? '' : String(chat.id),
    chatname: chat.title || (chat.username ? `@${chat.username}` : fullName),
    groupname: groupChat ? (chat.title || '') : '',
    language: from.language_code || '',
    isbot: String(Boolean(from.is_bot)),
    command: `/${parsed.name}`,
    input: parsed.input,
    messageid: message.message_id === undefined ? '' : String(message.message_id),
    botname: config.bot_label || config.name || '',
    botusername: botUsername ? `@${botUsername}` : '',
    date: iso.slice(0, 10),
    time: iso.slice(11, 19),
    timestamp: iso,
    totalstarts: String(Number(stats.totalStarts || 0)),
    totalmessages: String(Number(stats.totalMessages || 0)),
    totalchats: String(Number(stats.totalChats || 0)),
  }
  const rendered = renderTemplate(response, values)
  if (parsed.name === 'start') return appendFixedStartFooter(rendered)
  return truncateTelegramText(rendered)
}
