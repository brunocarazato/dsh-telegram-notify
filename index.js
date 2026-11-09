/**
 * Telegram notifications for the DeepSeek Harness.
 *
 * Notifies a Telegram chat when an Agent asks the human a question
 * (`user-questions/request`) and when an Agent finishes a run of work
 * (its durable `turn/end` is followed by the status returning to `idle`).
 *
 * The agent's Markdown is rendered into the Telegram HTML dialect so that
 * bold text, lists, code, links, and headings arrive formatted instead of as
 * literal asterisks; `formatMarkdown` in the plugin settings turns that off.
 *
 * Cordis reads a plugin's `Config` as a static property of the module's
 * default export, so the default export carries `Config` and the other entry
 * fields; the named exports exist for direct imports.
 *
 * @module @local/telegram-notify
 */

import { createSchema, z } from './schema.js'

export const name = 'telegram-notify'

export const inject = ['credentials', 'agents']

export const TOKEN_SCOPE = 'telegram-notify'
export const TOKEN_ID = 'bot'
export const TOKEN_ENV = 'TELEGRAM_BOT_TOKEN'

const RECORD_KEY = `${TOKEN_SCOPE}/${TOKEN_ID}`
const API_ORIGIN = 'https://api.telegram.org'
const REFRESH_WINDOW_MS = 2000
const SESSION_TTL_MS = 6 * 60 * 60 * 1000
const MAX_CACHED_SESSIONS = 200

/** Configuration schema shown by the plugin settings surface. Every field is
 * volatile so edits apply live through the settings form without remounting. */
export const Config = createSchema({
  enabled: z.boolean().default(true).volatile().description('Enviar notificações no Telegram.'),
  chatId: z.string().default('').volatile().description('Chat ID que recebe as notificações; vazio descobre a partir de uma mensagem enviada ao bot.'),
  notifyQuestions: z.boolean().default(true).volatile().description('Notificar quando o agente fizer uma pergunta.'),
  notifyFinished: z.boolean().default(true).volatile().description('Notificar quando um agente de nível raiz terminar o trabalho.'),
  formatMarkdown: z.boolean().default(true).volatile().description('Formatar Markdown (negrito, listas, código, links) no estilo do Telegram em vez de enviar o texto cru.'),
  minTurnDurationMs: z.number().default(8000).volatile().description('Duração mínima de uma execução para notificar o fim; execuções mais curtas ficam silenciosas.'),
  includeResponse: z.boolean().default(true).volatile().description('Incluir um trecho da resposta final na notificação de conclusão.'),
  excerptChars: z.number().default(900).volatile().description('Tamanho máximo do trecho da resposta final.'),
  silentHours: z.array(z.string()).default([]).volatile().description('Intervalos locais "HH:MM-HH:MM" em que a mensagem é enviada sem som.'),
  locale: z.enum(['pt-BR', 'en']).default('pt-BR').volatile().description('Idioma do texto das notificações.'),
  apiOrigin: z.string().default(API_ORIGIN).volatile().description('Origem da Bot API; altere apenas para um proxy ou servidor de teste.'),
  timeoutMs: z.number().default(10000).volatile().description('Tempo limite das requisições à Bot API, em milissegundos.'),
  dedupeMs: z.number().default(3000).volatile().description('Janela mínima entre notificações idênticas repetidas.')
})

const DEFAULTS = {
  enabled: true,
  chatId: '',
  notifyQuestions: true,
  notifyFinished: true,
  formatMarkdown: true,
  minTurnDurationMs: 8000,
  includeResponse: true,
  excerptChars: 900,
  silentHours: [],
  locale: 'pt-BR',
  apiOrigin: API_ORIGIN,
  timeoutMs: 10000,
  dedupeMs: 3000
}

const TEXT = {
  pt: {
    question: 'O agente está aguardando uma resposta sua',
    finished: 'O agente terminou o trabalho',
    unfinished: 'O agente parou sem terminar o trabalho',
    failed: 'O agente parou com erro',
    session: 'Conversa',
    help: (chatId) => `Chat ID: ${chatId}\nPronto! Este chat vai receber as notificações do DeepSeek Harness.`,
    ok: 'Notificações do DeepSeek Harness ativadas neste chat.',
    start: 'Ativar notificações deste chat'
  },
  en: {
    question: 'The agent is waiting for your answer',
    finished: 'The agent finished its work',
    unfinished: 'The agent stopped before finishing',
    failed: 'The agent stopped with an error',
    session: 'Conversation',
    help: (chatId) => `Chat ID: ${chatId}\nYou are all set! This chat receives DeepSeek Harness notifications.`,
    ok: 'DeepSeek Harness notifications are enabled for this chat.',
    start: 'Enable notifications for this chat'
  }
}

//#region Markdown → Telegram HTML

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

/** Escape text for the Telegram HTML dialect. */
function escapeHtml(text) {
  return String(text).replaceAll(/[&<>"]/g, (character) => ESCAPE[character])
}

/**
 * Render inline Markdown into Telegram HTML: code spans first (their contents
 * stay literal), then emphasis, links, and bare URLs.
 * @param text - inline Markdown source.
 * @param links - whether links are rendered as anchors or kept as plain text.
 * @returns Telegram-flavored HTML.
 */
function renderInline(text, links) {
  const stash = []
  const hold = (html) => `\u0000${String(stash.push(html) - 1)}\u0000`

  let work = escapeHtml(text)

  work = work.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_match, _ticks, code) => hold(`<code>${code.trim()}</code>`))

  work = work.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt, url) => hold(links
    ? `<a href="${url}">${alt === '' ? '🖼 imagem' : alt}</a>`
    : (alt === '' ? 'imagem' : alt)))

  work = work.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label, url) => hold(links
    ? `<a href="${url}">${label}</a>`
    : `${label} (${url})`))

  work = work.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<b>$1</b>')
  work = work.replace(/__(?=\S)([\s\S]*?\S)__/g, '<b>$1</b>')
  work = work.replace(/(?<![*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, '<i>$1</i>')
  work = work.replace(/(?<![_\w])_(?=\S)([^_\n]*?\S)_(?![_\w])/g, '<i>$1</i>')
  work = work.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>')

  if (links) {
    work = work.replace(/(?<!["=])(https?:\/\/[^\s<>)"]+)/g, (url) => {
      // Sentence punctuation after a bare URL belongs to the sentence, not the link.
      const match = /^(.*?)((?:[.,;:!?]+|\u2026))?$/.exec(url)
      const target = match?.[1] ?? url
      const trailing = match?.[2] ?? ''
      return `<a href="${target}">${target}</a>${trailing}`
    })
  }

  return work.replace(/\u0000(\d+)\u0000/g, (_match, index) => stash[Number(index)])
}

/**
 * Convert agent Markdown into the Telegram HTML dialect, which supports only
 * bold, italic, underline, strikethrough, spoilers, links, code, and pre.
 * Headings become bold lines, bullets become `•`, and tables become aligned
 * plain text, because Telegram cannot render them.
 * @param markdown - the Markdown source, typically an agent answer.
 * @param options.links - render URLs as anchors (default true).
 * @returns Telegram-flavored HTML.
 */
export function markdownToTelegramHtml(markdown, options = {}) {
  const links = options.links !== false
  const source = String(markdown ?? '').replaceAll('\r\n', '\n')
  const out = []
  let fence
  let fenceLanguage = ''
  let code = []

  const closeFence = () => {
    if (fence === undefined) return
    const body = code.join('\n')
    out.push(fenceLanguage === ''
      ? `<pre>${body}</pre>`
      : `<pre><code class="language-${fenceLanguage}">${body}</code></pre>`)
    fence = undefined
    fenceLanguage = ''
    code = []
  }

  for (const line of source.split('\n')) {
    const fenceMatch = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(line)
    if (fenceMatch !== null) {
      if (fence === undefined) fence = fenceMatch[1], fenceLanguage = fenceMatch[2]
      else closeFence()
      continue
    }
    if (fence !== undefined) {
      code.push(escapeHtml(line))
      continue
    }

    if (/^\s*$/.test(line)) {
      out.push('')
      continue
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading !== null) {
      out.push(`<b>${renderInline(heading[2], links)}</b>`)
      continue
    }

    if (/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/.test(line)) {
      out.push('——————')
      continue
    }

    // Markdown table rows are flattened: Telegram has no table rendering.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell) || cell === '')) continue
      out.push(cells.map((cell) => renderInline(cell, links)).join(' · '))
      continue
    }

    const quote = /^\s{0,3}>\s?(.*)$/.exec(line)
    if (quote !== null) {
      out.push(`<blockquote>${renderInline(quote[1], links)}</blockquote>`)
      continue
    }

    const bullet = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line)
    if (bullet !== null) {
      const indent = '  '.repeat(Math.min(3, Math.floor(bullet[1].length / 2)))
      const marker = /^\d/.test(bullet[2]) ? bullet[2] : '•'
      out.push(`${indent}${marker} ${renderInline(bullet[3], links)}`)
      continue
    }

    out.push(renderInline(line, links))
  }
  closeFence()

  return out.join('\n').replaceAll(/\n{3,}/g, '\n\n').trim()
}

/** Drop Markdown syntax without producing HTML: the unformatted fallback. */
export function markdownToPlain(markdown) {
  return String(markdown ?? '')
    .replaceAll(/\r\n/g, '\n')
    .replace(/^\s*```[\w+-]*\s*$/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/gm, '$1')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(?<![*\w])([*_])(?=\S)([^*_\n]*?\S)\1(?![*\w])/g, '$2')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    .replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, '$2')
    .trim()
}

//#endregion

/** Read the text blocks of an assistant or user message. */
function messageText(message) {
  const blocks = message?.content
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/** Flatten one question item into Markdown-ish plain text. */
function questionText(item, index, total) {
  const lines = []
  if (typeof item?.header === 'string' && item.header.trim() !== '') lines.push(`**${item.header.trim()}**`)
  if (typeof item?.question === 'string') lines.push(item.question)
  const options = Array.isArray(item?.options) ? item.options : []
  if (options.length > 0) lines.push(options.map((option) => `- ${String(option?.label ?? '')}`).join('\n'))
  const body = lines.filter((line) => line !== '').join('\n')
  return total > 1 ? `${String(index + 1)}. ${body}` : body
}

function truncate(text, max) {
  if (typeof text !== 'string') return ''
  const clean = text.trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function parseHourRange(range) {
  const [from, to] = String(range).split('-')
  const read = (value) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim())
    if (match === null) return undefined
    const hours = Number(match[1])
    const minutes = Number(match[2])
    if (hours > 23 || minutes > 59) return undefined
    return hours * 60 + minutes
  }
  const start = read(from)
  const end = read(to)
  return start === undefined || end === undefined ? undefined : { start, end }
}

/** How one finished run is described. */
function outcome(reason, lang) {
  const kind = reason?.kind
  if (kind === 'error') return { emoji: '⚠️', title: lang.failed }
  if (kind === 'aborted' || kind === 'blocked' || kind === 'max-tokens' || kind === 'interrupted') return { emoji: '⏸️', title: lang.unfinished }
  return { emoji: '✅', title: lang.finished }
}

/** Read a config field whether it is a plain value or a volatile accessor. */
function field(config, key) {
  const value = config?.[key]
  return typeof value?.get === 'function' ? value.get() : value
}

export async function apply(ctx, rawConfig) {
  const config = {}
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = field(rawConfig, key)
    config[key] = value === undefined ? fallback : value
  }
  // Settings edits arrive as volatile accessors on every later apply.
  const live = (key) => {
    const value = field(rawConfig, key)
    return value === undefined ? DEFAULTS[key] : value
  }
  const log = ctx.logger
  const lang = config.locale === 'en' ? TEXT.en : TEXT.pt
  const state = {
    chats: new Set(),
    chatId: typeof config.chatId === 'string' ? config.chatId.trim() : '',
    sessions: new Map(),
    cache: { at: 0, messages: [] },
    dedupe: new Map(),
    offset: 0,
    token: undefined,
    tokenCheckedAt: 0,
    authFailure: undefined
  }
  log.info('telegram-notify: ativo (perguntas=%s, conclusão=%s, markdown=%s, chat=%s)',
    String(config.notifyQuestions), String(config.notifyFinished), String(config.formatMarkdown), state.chatId || 'a descobrir')

  /** Resolve the bot token from the credential record, falling back to the environment. */
  async function readToken(force = false) {
    const now = Date.now()
    if (!force && state.token !== undefined && now - state.tokenCheckedAt < REFRESH_WINDOW_MS) return state.token
    state.tokenCheckedAt = now
    let value
    try {
      const info = await ctx.credentials.describeRecord(RECORD_KEY)
      if (info.configured) {
        const record = await ctx.credentials.readRecord(RECORD_KEY)
        const key = record?.kind === 'api-key' ? record.key : undefined
        if (typeof key === 'string' && key.trim() !== '') value = key.trim()
      }
    } catch (error) {
      log.warn('telegram-notify: could not read the bot token record: %s', String(error))
    }
    if (value === undefined) {
      const resolved = await ctx.credentials.resolve(TOKEN_ENV)
      if (resolved !== undefined && typeof resolved.value === 'string' && resolved.value.trim() !== '') value = resolved.value.trim()
    }
    state.token = value
    return value
  }

  async function call(method, body) {
    const botToken = await readToken()
    if (botToken === undefined) return undefined
    let response
    try {
      response = await fetch(`${config.apiOrigin.replace(/\/$/, '')}/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(config.timeoutMs)
      })
    } catch (error) {
      throw new Error(`network: ${String(error)}`)
    }
    const payload = await response.json().catch(() => undefined)
    if (payload !== undefined && payload.ok === false) {
      if (payload.error_code === 401) {
        state.token = undefined
        state.tokenCheckedAt = 0
        if (state.authFailure !== botToken) {
          state.authFailure = botToken
          log.warn('telegram-notify: o token do bot foi recusado (%s); grave um novo token e ele passa a valer automaticamente', String(payload.description ?? ''))
        }
      }
      throw new Error(payload.description ?? `Telegram API error ${String(payload.error_code ?? response.status)}`)
    }
    if (!response.ok) throw new Error(`Telegram API HTTP ${String(response.status)}`)
    return payload
  }

  /** Recent inbound messages to the bot, oldest first. */
  async function recentMessages(force = false) {
    const now = Date.now()
    if (!force && now - state.cache.at < REFRESH_WINDOW_MS) return state.cache.messages
    const payload = await call('getUpdates', {
      offset: state.offset > 0 ? state.offset : undefined,
      timeout: 0,
      allowed_updates: ['message']
    })
    const updates = Array.isArray(payload?.result) ? payload.result : []
    const messages = updates
      .map((update) => ({
        updateId: update?.update_id,
        chatId: update?.message?.chat?.id,
        text: typeof update?.message?.text === 'string' ? update.message.text : ''
      }))
      .filter((message) => message.chatId !== undefined)
    state.cache = { at: now, messages }
    return messages
  }

  function silentNow(now) {
    const date = new Date(now)
    const minutes = date.getHours() * 60 + date.getMinutes()
    return config.silentHours.some((range) => {
      const parsed = parseHourRange(range)
      if (parsed === undefined) return false
      return parsed.start <= parsed.end
        ? minutes >= parsed.start && minutes < parsed.end
        : minutes >= parsed.start || minutes < parsed.end
    })
  }

  /**
   * Send one notification. `text` is Markdown when `markdown` is set; the
   * formatted rendering is used when enabled, otherwise the plain text is sent
   * with no parse mode at all so nothing can be misread as markup.
   */
  async function send(text, options = {}) {
    if (!live('enabled')) return
    const configured = String(live('chatId') ?? '').trim()
    const chatId = configured !== '' ? configured : state.chats.values().next().value
    if (chatId === undefined) {
      log.warn('telegram-notify: no chat configured yet; send any message to the bot on Telegram')
      return
    }
    const markdown = options.markdown === true && live('formatMarkdown')
    const body = {
      chat_id: chatId,
      text: markdown ? markdownToTelegramHtml(text) : (options.markdown === true ? markdownToPlain(text) : text),
      disable_web_page_preview: true,
      ...markdown ? { parse_mode: 'HTML' } : {},
      ...options.silent === true || silentNow(Date.now()) ? { disable_notification: true } : {}
    }
    try {
      await call('sendMessage', body)
    } catch (error) {
      // A malformed entity must not swallow the notification: resend unformatted.
      if (!markdown) {
        log.warn('telegram-notify: could not send the notification: %s', String(error))
        return
      }
      log.warn('telegram-notify: formatted message rejected (%s); sending it as plain text', String(error))
      try {
        await call('sendMessage', { ...body, text: markdownToPlain(text), parse_mode: undefined })
      } catch (retry) {
        log.warn('telegram-notify: could not send the notification: %s', String(retry))
      }
    }
  }

  /** Per-session notification facts, refreshed from the log as it grows. */
  function sessionInfo(session, agent) {
    const now = Date.now()
    let info = state.sessions.get(session.id)
    if (info === undefined) {
      info = { title: '', startedAt: now, lastTurnEnd: undefined, lastText: '' }
      state.sessions.set(session.id, info)
      for (const [key, value] of state.sessions) {
        if (state.sessions.size <= MAX_CACHED_SESSIONS) break
        if (now - (value.lastTurnEnd?.at ?? value.startedAt) > SESSION_TTL_MS || state.sessions.size > MAX_CACHED_SESSIONS) state.sessions.delete(key)
      }
    }
    if (info.title === '') {
      const first = session.snapshotEvents?.()?.find((event) => event.type === 'user/message')
      const text = first === undefined ? '' : messageText(first.data)
      if (text !== '') info.title = truncate(markdownToPlain(text).replaceAll(/\s+/g, ' '), 80)
    }
    if (info.title === '' && agent?.id !== undefined) info.title = String(agent.id)
    return info
  }

  function header(emoji, title, info) {
    const lines = [`${emoji} **${title}**`]
    if (info?.title) lines.push(`_${lang.session}: ${truncate(info.title, 90)}_`)
    return lines.join('\n')
  }

  const liveAgentFor = (session) => {
    try {
      return ctx.agents.list().find((candidate) => candidate.session === session)
    } catch {
      return undefined
    }
  }

  // --- ask_user_question -------------------------------------------------

  function notifyQuestion(request) {
    if (!live('notifyQuestions')) return
    const questions = Array.isArray(request?.questions) ? request.questions : []
    const agent = request?.agent
    const session = agent?.session
    const info = session === undefined ? undefined : sessionInfo(session, agent)
    const items = questions.slice(0, 4).map((item, index) => questionText(item, index, questions.length))
    if (questions.length > 4) items.push(`- +${String(questions.length - 4)}`)
    const body = items.filter((item) => item !== '').join('\n\n')
    const now = Date.now()
    const key = `${String(agent?.id ?? '')}:${body}`
    const last = state.dedupe.get(key)
    if (last !== undefined && now - last < config.dedupeMs) return
    state.dedupe.set(key, now)
    for (const [entry, at] of state.dedupe) if (now - at > config.dedupeMs) state.dedupe.delete(entry)
    send([header('❓', lang.question, info), '', truncate(body, 2500)].join('\n'), { markdown: true })
      .catch((error) => log.warn('telegram-notify: question notification failed: %s', String(error)))
  }

  // --- bot commands ------------------------------------------------------

  async function handleCommand(message) {
    const text = message.text.trim()
    if (!text.startsWith('/')) return
    const command = text.slice(1).split(/\s+/)[0].split('@')[0]
    if (command !== 'start' && command !== 'help') return
    await call('sendMessage', {
      chat_id: String(message.chatId),
      text: lang.help(String(message.chatId)),
      disable_web_page_preview: true
    }).catch((error) => log.warn('telegram-notify: could not answer the bot command: %s', String(error)))
  }

  let polling = false
  async function poll() {
    if (polling) return
    if (await readToken() === undefined) return
    polling = true
    try {
      const messages = await recentMessages(true)
      let highest = state.offset
      for (const message of messages) {
        if (typeof message.updateId === 'number' && message.updateId >= highest) highest = message.updateId + 1
        state.chats.add(String(message.chatId))
        if (String(live('chatId') ?? '').trim() === '' && message.text.trim() !== '') {
          state.chatId = String(message.chatId)
          await call('setMyCommands', { commands: [{ command: 'start', description: lang.start }] }).catch(() => {})
          await call('sendMessage', { chat_id: state.chatId, text: lang.ok, disable_web_page_preview: true }).catch(() => {})
          log.info('telegram-notify: chat %s configured', state.chatId)
        }
        await handleCommand(message)
      }
      state.offset = highest
    } catch (error) {
      log.debug('telegram-notify: update polling failed: %s', String(error))
    } finally {
      polling = false
    }
  }

  // --- wiring ------------------------------------------------------------

  // The question notification must not delay or alter the answer waterfall.
  ctx.on('user-questions/request', (request, next) => {
    try {
      notifyQuestion(request)
    } catch (error) {
      log.warn('telegram-notify: question notification failed: %s', String(error))
    }
    return next()
  }, { prepend: true })

  // Run start: remember when the current run began.
  ctx.on('agent/status', (payload) => {
    const { agent, status } = payload ?? {}
    if (status !== 'running' || agent?.session === undefined) return
    const info = sessionInfo(agent.session, agent)
    info.startedAt = Date.now()
    info.lastTurnEnd = undefined
  })

  // Durable end-of-turn record: how the turn ended and what the agent last said.
  ctx.on('session/event', (session, event) => {
    const agent = liveAgentFor(session)
    if (agent === undefined) return
    const info = sessionInfo(session, agent)
    if (event.type === 'session/title') {
      const title = event.data?.title
      if (typeof title === 'string' && title.trim() !== '') info.title = title.trim()
    } else if (event.type === 'assistant/message') {
      const text = messageText(event.data?.message)
      if (text !== '') info.lastText = text
    } else if (event.type === 'turn/end') {
      info.lastTurnEnd = { at: Date.now(), reason: event.data?.reason, text: info.lastText }
    }
  })

  // Run end: a root agent returns to idle after it really ran a turn.
  ctx.on('agent/status', (payload) => {
    const { agent, status } = payload ?? {}
    if (status !== 'idle' || !live('notifyFinished') || agent?.session === undefined) return
    const session = agent.session
    const info = sessionInfo(session, agent)
    const startedAt = info.startedAt
    const end = info.lastTurnEnd
    info.startedAt = Date.now()
    info.lastTurnEnd = undefined
    if (startedAt === undefined || end === undefined) return
    let lastTurn = 0
    try {
      lastTurn = ctx.agents.turnBoundaryOf(session)?.lastTurn ?? 0
    } catch {
      lastTurn = 1
    }
    if (lastTurn === 0) return
    if (Date.now() - startedAt < live('minTurnDurationMs')) return
    const { emoji, title } = outcome(end.reason, lang)
    const lines = [header(emoji, title, info)]
    const message = end.reason?.error?.message
    if (typeof message === 'string' && message !== '') lines.push(`_${truncate(message, 300)}_`)
    const response = live('includeResponse') ? truncate(end.text ?? '', live('excerptChars')) : ''
    if (response !== '') lines.push('', response)
    send(lines.join('\n'), { markdown: true }).catch((error) => log.warn('telegram-notify: finished notification failed: %s', String(error)))
  })

  // Discover the chat and enable bot commands in it.
  const timer = setInterval(() => {
    poll().catch((error) => log.debug('telegram-notify: poll cycle failed: %s', String(error)))
  }, 4000)
  timer.unref?.()
  ctx.effect(() => () => {
    clearInterval(timer)
    state.sessions.clear()
    state.dedupe.clear()
  })
  poll().catch((error) => log.debug('telegram-notify: initial poll failed: %s', String(error)))
}

// Cordis reads `Config` and the entry fields from the module's default export.
const plugin = apply
Object.defineProperties(plugin, {
  Config: { value: Config, enumerable: true },
  inject: { value: inject, enumerable: true },
  name: { value: 'telegram-notify', configurable: true }
})
export default plugin
