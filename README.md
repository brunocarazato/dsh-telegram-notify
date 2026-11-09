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
  environment.

The token is never stored in the plugin's patch or configuration.

### 2. The chat

Open **Plugins → Telegram notifications**. That page holds every setting in a
form:

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | turn all notifications off |
| `chatId` | `''` | target chat; empty discovers it |
| `notifyQuestions` | `true` | notify on agent questions |
| `notifyFinished` | `true` | notify when a run ends |
| `formatMarkdown` | `true` | render Markdown in Telegram style |
| `minTurnDurationMs` | `8000` | runs shorter than this stay quiet |
| `includeResponse` | `true` | append an excerpt of the final answer |
| `excerptChars` | `900` | excerpt length |
| `silentHours` | `[]` | local `"22:00-07:00"` ranges sent without sound |
| `locale` | `pt-BR` | message language (`pt-BR` or `en`) |
| `timeoutMs` | `10000` | Bot API request timeout |
| `dedupeMs` | `3000` | suppress an identical question inside this window |

Leave `chatId` empty and send any message (or `/start`) to your bot once. The
plugin discovers the chat from that message and replies confirming it is
enabled.

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
| `[label](url)`, bare URLs | clickable link |
| tables | cells joined with `·` (Telegram has no tables) |
| `<`, `&`, `"` | escaped, never interpreted as markup |

With it off, the Markdown is stripped and the message is sent as plain text
with no parse mode. If Telegram rejects a formatted message, the plugin resends
it as plain text instead of dropping the notification.

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

- Renaming the **package** deselects the bundle and disables its entry. Re-enable
  it after a rename; keep the name stable once installed.
- The browser factory `id` must equal the package name.
- The token is re-read per operation, so replacing it needs no restart.
- Sending never blocks the agent: a question notification fires and forgets, and
  the answer always continues.

## License

MIT
