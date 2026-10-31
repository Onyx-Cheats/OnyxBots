# TODO

- [x] Publish the supplied ZIP as a website: https://www.mediafire.com/file/tiq4nvju7h309b2/onyx-bot-builder-dashboard-main.zip/file. Preserve its original ONYX dashboard UI, navigation, assets, responsive layout, and command-building controls.
- [x] Add the custom Telegram server so configured bots answer `/start`, `/help`, and custom commands through production HTTPS webhooks; encrypt BotFather tokens at rest and verify Telegram webhook secret headers.
- [x] Add managed MySQL, hybrid static/container deployment, health, and ordered API/static routes. Clean build, TypeScript, server tests, and production route checks have previously passed.
- [x] Remove Manus sign-in from active routes and use per-bot 256-bit private management links; store only hashes, support rotation and token-verified recovery, and preserve legacy auth records without using them for access.
- [x] Request Always On; the platform refused it because owner membership is required. Keep the user-approved Autoscale fallback; it may sleep while idle and cold-start. Do not add keep-alive traffic.
- [x] Publish auth-free checkpoint `13f9ad3058163eba0b3eec9f5e2732b77d86859f`; production pages, route manifest, backend health, and removed-auth behavior were verified.
- [ ] When a user enters a BotFather token for a bot already connected to ONYX, verify it and update that same bot's settings rather than rejecting it as a duplicate; redeploy it and issue a replacement private management link.
- [ ] Show errors and operation results as dismissible notification toasts, not as a message above the editor. After a successful deploy, show exactly `Bot deployed — check it out @<telegram_username>.`.
- [ ] Keep the `/start` welcome message editable but always append the uneditable, server-enforced `MADE WITH @onyxbotsofficial` footer.
- [ ] In Add Commands, list supported template variables with descriptions and a **Use** button that inserts each token into the response. Support `#username$`, `#firstname$`, `#lastname$`, `#userid$`, `#chatid$`, `#chatname$`, `#groupname$`, `#language$`, `#isbot$`, `#command$`, `#input$`, `#messageid$`, `#botname$`, `#botusername$`, `#date$`, `#time$`, `#timestamp$`, `#totalstarts$` (rolling last 24 hours), `#totalmessages$` (rolling last 24 hours), and `#totalchats$` (all time).
- [ ] Publish the updated checkpoint and verify clean build, command-variable behavior, and production health without creating fake bot rows or using a real BotFather token.
