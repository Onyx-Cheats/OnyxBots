# ONYX Bot Builder

ONYX configures Telegram bots with a real HTTPS webhook server. There is no Manus or Google sign-in. Each bot has its own private management link; possession of that link authorizes access to that bot only.

## Create and manage a bot

1. Open the published website and create a Telegram bot with [@BotFather](https://t.me/BotFather).
2. Enter the BotFather API token in Setup, configure its name, `/start`, `/help`, and optional custom commands, then choose **Save & Deploy Bot**.
3. If the token already belongs to an ONYX bot, ONYX updates that same bot and redeploys it instead of rejecting the token. It rotates the bot's management link and revokes the previous one.
4. On success, the dashboard shows **“Bot deployed — check it out @<telegram_username>.”** Copy the private management link and keep it like a password. Anyone with the link can edit, redeploy, inspect analytics for, or delete that bot.
5. Reopen the link to manage the bot from another browser. If you lose it, use **Recover access** and re-enter the matching BotFather token; ONYX verifies it with Telegram and issues a replacement link.
6. Open the bot in Telegram and try `/start`, `/help`, or a configured command. The user-written `/start` welcome stays editable; the server always appends the fixed, uneditable footer `MADE WITH @onyxbotsofficial`. ONYX does not generate arbitrary AI replies to free-form messages.

The management key is carried in the URL fragment, which is not sent to the server in the HTTP request or referrer. ONYX removes it from the address bar after reading and keeps it only for the current browser tab. Copy the full link before leaving; if it is lost, recover access with the BotFather token. No real BotFather token is bundled with this project, so no bot is live until a user adds one and Telegram accepts the webhook.

## Command variables

In **Commands → Add command → Response text**, expand **Personalize with variables** and press **Use** to insert a token. The server replaces tokens when replying. Unknown tokens are left unchanged.

| Token | Value |
| --- | --- |
| `#username$` | Telegram `@username`, or the sender's first name when no handle is set |
| `#firstname$` | Sender's first name |
| `#lastname$` | Sender's last name, if set |
| `#userid$` | Sender's Telegram user ID |
| `#chatid$` | Current Telegram chat ID |
| `#chatname$` | Group title or private-chat name |
| `#groupname$` | Group/supergroup title; blank in a private chat |
| `#language$` | Telegram language code, if available |
| `#isbot$` | `true` or `false` for the sender |
| `#command$` | The triggering command, such as `/rules` |
| `#input$` | Text following the command, such as `hello` in `/echo hello` |
| `#messageid$` | Telegram message ID that triggered the reply |
| `#botname$` | Bot display name saved in ONYX |
| `#botusername$` | This bot's Telegram `@username` |
| `#date$` | Current UTC date (`YYYY-MM-DD`) |
| `#time$` | Current UTC time (`HH:MM:SS`) |
| `#timestamp$` | Current UTC timestamp in ISO 8601 |
| `#totalstarts$` | `/start` commands in the rolling last 24 hours, including the current one |
| `#totalmessages$` | Messages received by the bot in the rolling last 24 hours |
| `#totalchats$` | Unique Telegram chats that have contacted the bot, all time |

Variables also work in the editable `/start` and `/help` text. The fixed brand footer is always added after the rendered `/start` welcome.

## Security and data

- BotFather tokens are encrypted at rest using AES-256-GCM and the protected `BOT_TOKEN_ENCRYPTION_KEY`. The key must remain stable and available in both Development and Production because they share the managed database. Do not rotate it without planned re-encryption.
- Management-link keys contain 256 bits of randomness and only their SHA-256 hashes are stored. There is one active link per bot; rotating or recovering it invalidates the previous key.
- Telegram webhooks use a derived per-bot `secret_token`. Requests without the matching `X-Telegram-Bot-Api-Secret-Token` are rejected before JSON parsing. Raw bot tokens and management keys are never logged or returned in later bot-read responses.
- The server stores aggregate activity and keyed chat identifiers, not message text or raw Telegram chat IDs. Rolling message/start counters store only update ID, event kind, and timestamp. Historical Manus auth tables are unused.
- Container files are ephemeral. Bot configuration, encrypted credentials, link-key hashes, and metrics are kept in managed MySQL.

## Development

The Node toolchain is pinned in `package.json` and `package-lock.json`.

```sh
npm ci
npm run dev:api   # Express API, port 3001
npm run dev       # Vite Preview, port 3000, proxies /api to 3001
npm test
npm run lint:types
npm run build
```

`npm run db:migrate` applies the checked-in additive schema. Development and Production share the same managed MySQL database; migrations and test writes affect production. Do not test with real bot tokens or insert fake customer/bot records.

The production container builds the static site in a build stage, installs only Express/MySQL in its runtime stage, runs additive migrations, and listens on `PORT` (default 3000). Its unauthenticated health endpoint is `/_app/health`.

## Hosting

Always On requires owner membership. The available Autoscale deployment can sleep after inactivity, so a webhook may have a cold start. No keep-alive pinger is used to defeat the platform's sleep policy.
