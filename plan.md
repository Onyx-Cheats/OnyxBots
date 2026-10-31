# Onyx Bot Builder — implementation plan

## Approved product behavior

Keep the published bot-link access model: there is no Manus sign-in, and each bot is authorized by its private management link. If a user enters a BotFather token already connected to ONYX, verify it with Telegram, update that same bot's settings, redeploy it, and issue a fresh link instead of returning a duplicate-token error. The server must never return the stored BotFather token.

Show operation results in a dismissible, temporary notification toast instead of the in-page message above the editor. On a successful deploy, show the exact status “Bot deployed — check it out @<telegram_username>.” Surface errors in the same toast component.

Keep the `/start` welcome text editable, but always append a server-enforced, uneditable `MADE WITH @onyxbotsofficial` footer. Apply template variables to welcome, help, and custom-command responses. The Commands tab will list each supported variable with a **Use** button that inserts it into that command's response.

## Template variables

Support and explain these exact tokens: `#username$` (Telegram handle, falling back to first name), `#firstname$`, `#lastname$`, `#userid$`, `#chatid$`, `#chatname$`, `#groupname$`, `#language$`, `#isbot$`, `#command$`, `#input$` (arguments after the command), `#messageid$`, `#botname$`, `#botusername$`, `#date$`, `#time$`, `#timestamp$`, `#totalstarts$` (starts in the rolling last 24 hours), `#totalmessages$` (messages in the rolling last 24 hours), and `#totalchats$` (unique chats all-time). Insert only an additive `003_bot_message_events.sql` table keyed by bot/update ID, store event type and timestamp only, and use it for deduplicated rolling counts; do not store message text or raw chat IDs.

## Existing integration, security, and design

Preserve the supplied dark ONYX dashboard, assets, routes, responsive layout, Express/MySQL hybrid host, encrypted BotFather-token storage, webhook secret validation, bot-link rotation/recovery, and production-only webhook registration. When upserting, retain the existing bot ID and encryption associated-data context, replace settings, and rotate the management link so the submitted token can restore access safely. Append branding in the server's `/start` response so the user cannot remove it by editing stored welcome text.

Database development and production share MySQL. The only schema change is the additive, idempotent message-event migration; webhook update IDs make counters retry-safe. Do not create fake bot rows or use any real BotFather token during checks.

## Project structure and delivery

- `src/routes/index.tsx`: notification toasts and bot/workspace flows.
- `src/lib/commandVariables.ts` and `src/components/ConnectedBotPanels.tsx`: documented tokens and insertion controls, retaining existing styling.
- `server/index.mjs`, `server/validation.mjs`: token-based upsert, templating, immutable `/start` footer, and webhook event counts.
- `db/migrations/`: additive 003 event-count migration.
- `test/`: isolated upsert/templating/branding tests without shared-database writes.
- `README.md`: document duplicate-token updates, the fixed footer, and every available variable.

Run Node syntax/unit checks, TypeScript, clean static build, and route-manifest checks; checkpoint on canonical `main` and publish the updated hybrid site. Preserve the saved Autoscale mode: Always On was blocked by the platform membership requirement, and the user accepted mild cold starts.
