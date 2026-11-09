# dsh-telegram-notify

Telegram notifications for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
a message in your chat when the agent asks you a question or finishes its work.

Works on Windows, macOS, and Linux — including the Harness Web GUI running
inside WSL.

## What it sends

| Notification | Trigger |
|---|---|
| ❓ Question | the agent calls `ask_user_question` |
| ✅ Finished | a top-level agent finishes its run |
| ⏸️ Stopped / ⚠️ Failed | the run ended aborted, blocked, by token limit, or by error |

Questions always notify. A finished run notifies only after
`minTurnDurationMs` (default 8 s), so quick one-liners stay quiet. Subagents and
child sessions stay silent.

## Install

The package is a **bundle**: installing it links the directory into your
profile and inserts one row through `cordis.patch.yml`.

### From a clone

```bash
git clone <this-repo> dsh-telegram-notify
```

Then install it in your profile. With the Harness, use the plugin manager —
pass the absolute path of the cloned directory as the bundle target — or from
the Web GUI: **Plugins → install from path**.

### Which directory to clone into

Clone it anywhere the Harness can read; the plugin never depends on its own
location. On WSL, prefer the Linux filesystem (`~/`) over `/mnt/c`: it is much
faster and avoids mixed line endings.

## Configure

Two things are required.

### 1. The bot token

Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
Store it in one of two places:

- **Credential store** (preferred), as the record `telegram-notify/bot` with
  kind `api-key`; or
- **Environment**: `TELEGRAM_BOT_TOKEN` in `$DSH_HOME/.env` or the process
  environment. The plugin warns once when it falls back to this path.

The token is never stored in the plugin's patch or configuration.

The credential record lives in `$DSH_HOME/.credentials.yaml` and can be added by
hand while the Harness is stopped (keep the file at mode `0600`):

```yaml
version: 1
records:
  telegram-notify/bot:
    kind: api-key
    key: "123456:AAH...your-token..."
```

The provider reads the file on change, so after saving the plugin picks the
token up without a restart. If the YAML is invalid or the file is readable by
group/others on POSIX, the provider refuses to load it.

### 2. The chat

Open the sidebar's **Plugins** page, scroll to **Built-in plugin settings**
(Portuguese UI: **Configurações de plug-in integradas**), and open the
**Telegram notifications** card. The form opens with the **Delivery** section,
where the **Chat ID** field lives — it is not under Settings. If the card is
missing after installing or restarting the Harness, refresh the browser page so
the client bundle loads.

That page holds every setting in a form:

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | turn all notifications off |
| `chatId` | `''` | numeric target chat; empty disables delivery |
| `notifyQuestions` | `true` | notify on agent questions |
| `notifyFinished` | `true` | notify when a run ends |
| `formatMarkdown` | `true` | render Markdown in Telegram style |
| `minTurnDurationMs` | `8000` | runs shorter than this stay quiet |
| `includeResponse` | `false` | append an excerpt of the final answer |
| `excerptChars` | `900` | excerpt length (at most 3000) |
| `silentHours` | `[]` | local `"22:00-07:00"` ranges sent without sound |
| `locale` | `pt-BR` | message language (`pt-BR` or `en`) |
| `apiOrigin` | `https://api.telegram.org` | Bot API origin; HTTPS only (HTTP for localhost) |
| `timeoutMs` | `10000` | Bot API request timeout |
| `dedupeMs` | `3000` | suppress an identical question inside this window |

To learn your chat id, send `/start` (or `/help`) to the bot. It replies with
the numeric id of that chat; paste it into `chatId` and save. The plugin only
delivers to that explicit id — it never adopts the first chat that messages the
bot, so a stranger who finds the bot cannot bind it to their own chat. With
`chatId` empty, delivery stays off and the plugin logs one warning.

If the settings card does not appear, the same value can be written directly to
the profile's own patch layer, `$DSH_HOME/profiles/<profile>/cordis.patch.yml`,
and the Harness restarted:

```yaml
- id: telegram-notify
  config:
    chatId: "123456789"
```

If the card opens but says **“This plugin is not loaded”** (Portuguese:
“Este plugin não está carregado”), the browser half is present while the Host
entry is not active, so there is no settings namespace to edit. Restart the
Harness and reload the page; if the Plugins page lists the row as disabled,
enable it there. The same YAML fallback above works in that state.

`includeResponse` is off by default because the agent's final answer (and the
error message shown for a failed run) can quote credentials, file paths, or
private data. Turn it on only for a chat you trust. Every outgoing message is
scrubbed for common secret shapes (Telegram bot tokens, API keys, AWS/GitHub/
Slack tokens, bearer tokens, private-key blocks, and `password`/`token`/`secret`
assignments) before it is sent.

## Markdown formatting

The agent writes Markdown; Telegram does not render it. With `formatMarkdown`
on, the plugin converts the message to Telegram's HTML dialect:

| Markdown | Telegram |
|---|---|
| `**bold**`, `*italic*`, `~~struck~~` | formatted text |
| `` `code` ``, ```` ```js ```` | monospace, with the language |
| `# Heading` | bold line |
| `- item` | `• item` |
| `1. item` | numbered list |
| `> quote` | block quote |
| `[label](url)`, bare URLs | clickable link (`http`, `https`, `tg`, `mailto` only) |
| tables | cells joined with `·` (Telegram has no tables) |
| `<`, `&`, `"` | escaped, never interpreted as markup |

With it off, the Markdown is stripped and the message is sent as plain text
with no parse mode. If Telegram rejects a formatted message, the plugin resends
it as plain text instead of dropping the notification. Messages longer than
Telegram's 4096-character limit are split into plain-text chunks.

## Security notes

- **The bot token is a bearer secret.** Telegram requires it in the request URL,
  so the plugin only sends it to an HTTPS origin (`http://` is accepted for
  localhost test servers). A malformed `apiOrigin` is rejected before any
  request, and the token is redacted from errors before they reach the log.
- **At rest** the token lives in the Harness credential store:
  `$DSH_HOME/.credentials.yaml`, under `records: telegram-notify/bot`. That file
  is plain-text YAML (not encrypted), created with mode `0600`; on POSIX the
  provider refuses to start if group or other permission bits are set. The
  `.env` fallback has no such permission check and is easier to leak or commit,
  so prefer the credential record.
- **Not a vault.** The credential service has no per-plugin access control:
  another installed plugin that declares `credentials` can read this record.
  Treat the token as readable by anything running in the same profile.
- **Explicit destination.** The plugin never auto-binds to the first chat that
  messages the bot; `chatId` must be set, and inbound commands from other chats
  get at most their own id echoed (never agent content).
- **Data minimization.** `includeResponse` is off by default, error messages are
  truncated, and outgoing text is scrubbed for common credential shapes. Even
  so, notification titles come from the session's first user message — review
  what you paste into a session if the chat is not fully trusted.

## How it works

- `index.js` — Host half: the notification listeners, the Telegram Bot API
  calls, and the Markdown conversion.
- `schema.js` — the configuration schema. The bundle lives in a user
  workspace, which cannot import `@deepseek-ai/schemastery`; this module
  reproduces the observable surface the Harness relies on (the
  `Symbol.for('schemastery')` brand, `~standard` validation, `dict`/`list`/
  `inner` nodes, and `meta.volatile`).
- `client.js` — browser half: the settings page in `plugins.item`, built on the
  host's `SettingsFormModel` and primitives.
- `cordis.patch.yml` — the bundle patch that inserts the plugin row.

## Notes and limitations

- `chatId` is required. Older builds adopted the first chat that messaged the
  bot; that discovery path was removed because any stranger could bind the bot
  to their own chat and receive the notifications. Send `/start` to the bot to
  get the id, then save it under **Plugins → Telegram notifications**.
- Renaming the **package** deselects the bundle and disables its entry. Re-enable
  it after a rename; keep the name stable once installed.
- The browser factory `id` must equal the package name.
- The token is re-read per operation, so replacing it needs no restart.
- Sending never blocks the agent: a question notification fires and forgets, and
  the answer always continues.
- The bot should be dedicated to this plugin: the polling loop consumes
  `getUpdates`, so another integration using the same token would compete for
  messages.

## License

MIT
