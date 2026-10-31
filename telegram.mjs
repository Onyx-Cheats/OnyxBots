const TELEGRAM_API = 'https://api.telegram.org'

export async function telegramCall(token, method, payload = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)

  try {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.ok) throw new Error('telegram_request_failed')
    return result.result
  } catch {
    // Provider URLs contain the bot token. Never bubble up fetch errors or URLs.
    throw new Error('telegram_request_failed')
  } finally {
    clearTimeout(timer)
  }
}
