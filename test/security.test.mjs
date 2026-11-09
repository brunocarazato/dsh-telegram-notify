/**
 * Integration harness for the security fixes: explicit chat binding, origin
 * validation, token redaction, link policy, and privacy defaults.
 * Run with: node test/security.test.mjs (or npm test)
 */
import assert from 'node:assert/strict'
import { apply, Config, markdownToTelegramHtml, redactSecrets } from '../index.js'
import { z } from '../schema.js'

const TOKEN = '123456:AAH-fake-token-value-0123456789abcdef'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload }
}

function makeHarness(initialConfig, updates = []) {
  const config = { ...initialConfig }
  const logs = []
  const calls = []
  const handlers = new Map()
  const pending = [...updates]
  const format = (args) => args.map((value) => (typeof value === 'string' ? value : String(value))).join(' ')
  const logger = {
    info: (...args) => logs.push({ level: 'info', text: format(args) }),
    warn: (...args) => logs.push({ level: 'warn', text: format(args) }),
    debug: (...args) => logs.push({ level: 'debug', text: format(args) })
  }
  const ctx = {
    logger,
    credentials: {
      describeRecord: async () => ({ configured: true, kind: 'api-key', writable: true }),
      readRecord: async () => ({ kind: 'api-key', key: TOKEN }),
      resolve: async () => undefined
    },
    agents: { list: () => [], turnBoundaryOf: () => ({ lastTurn: 1 }) },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(handler)
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') ctx.disposers.push(dispose)
    },
    disposers: []
  }
  const rawConfig = new Proxy({}, { get: (_target, key) => ({ get: () => config[key] }) })

  globalThis.fetch = async (url, options) => {
    const text = String(url)
    calls.push({ url: text, body: JSON.parse(options.body) })
    if (text.includes('/getUpdates')) return response({ ok: true, result: pending.splice(0) })
    if (text.includes('/sendMessage') || text.includes('/setMyCommands')) return response({ ok: true, result: true })
    return response({ ok: false, error_code: 400, description: 'unexpected method' })
  }
  return { ctx, config, logs, calls, handlers, rawConfig }
}

function emit(harness, event, ...args) {
  for (const handler of harness.handlers.get(event) ?? []) handler(...args)
}

const question = (text) => ({
  agent: { id: 'agent-1', session: { id: 'session-1', snapshotEvents: () => [] } },
  questions: [{ question: text }]
})

// --- pure helpers ---------------------------------------------------------

assert.equal(markdownToTelegramHtml('[x](javascript:alert(1))').includes('href="javascript'), false, 'javascript: link must not become an anchor')
assert.equal(markdownToTelegramHtml('[x](https://example.com/a?b=1&c=2)').includes('<a href="https://example.com/a?b=1&amp;c=2">'), true, 'https link still works')
assert.equal(markdownToTelegramHtml("[x](data:text/html;base64,PHNjcmlwdD4=)").includes('href="data:'), false, 'data: link must not become an anchor')
const redacted = redactSecrets('telegram 123456:AAH-fake-token-value-0123456789abcdef and token=supersecret12345')
assert.equal(redacted.includes('AAH-fake-token'), false)
assert.equal(redacted.includes('supersecret12345'), false)
assert.equal(redacted.includes('[redacted]'), true)

const defaults = Config.resolve({})
assert.equal(defaults.includeResponse, false, 'includeResponse is off by default')
assert.equal(defaults.chatId, '', 'no chat is configured by default')

const polluted = z.object({ a: z.string() }).resolve(JSON.parse('{"a":"ok","__proto__":{"polluted":true}}'))
assert.equal(polluted.polluted, undefined, '__proto__ must not reach the prototype')

// --- no chat configured: a stranger cannot bind the bot -------------------

{
  const harness = makeHarness(
    { enabled: true, chatId: '', notifyQuestions: true, notifyFinished: true, formatMarkdown: true,
      minTurnDurationMs: 0, includeResponse: false, excerptChars: 900, silentHours: [], locale: 'pt-BR',
      apiOrigin: 'https://api.telegram.org', timeoutMs: 10000, dedupeMs: 3000 },
    [{ update_id: 1, message: { chat: { id: 999 }, text: '/start' } }]
  )
  await apply(harness.ctx, harness.rawConfig)
  await sleep(200)
  const messages = harness.calls.filter((call) => call.url.includes('/sendMessage'))
  assert.equal(messages.some((call) => call.body.chat_id === '999' && String(call.body.text).includes('Qual a senha')), false)
  const help = messages.find((call) => call.body.chat_id === '999')
  assert.ok(help !== undefined, 'the bot replies with the chat id')
  assert.match(String(help.body.text), /999/, 'reply carries the chat id')
  assert.doesNotMatch(String(help.body.text), /ativadas/, 'empty config must not claim notifications are enabled')

  emit(harness, 'user-questions/request', question('Qual a senha?'), async () => {})
  await sleep(200)
  assert.equal(harness.calls.some((call) => String(call.body.text ?? '').includes('Qual a senha')), false, 'no notification without chatId')
  assert.ok(harness.logs.some((entry) => entry.text.includes('chatId is not set')), 'warns once that delivery is off')
  for (const dispose of harness.ctx.disposers) dispose()
}

// --- configured chat: notification, redaction, link policy ----------------

{
  const harness = makeHarness({
    enabled: true, chatId: '123', notifyQuestions: true, notifyFinished: true, formatMarkdown: true,
    minTurnDurationMs: 0, includeResponse: false, excerptChars: 900, silentHours: [], locale: 'pt-BR',
    apiOrigin: 'https://api.telegram.org', timeoutMs: 10000, dedupeMs: 0
  })
  await apply(harness.ctx, harness.rawConfig)
  await sleep(100)

  emit(harness, 'user-questions/request', question('token=supersecret12345 [x](javascript:alert(1))'), async () => {})
  await sleep(200)
  const notification = harness.calls.find((call) => call.body.chat_id === '123' && String(call.body.text).includes('aguardando'))
  assert.ok(notification !== undefined, 'configured chat receives the question')
  assert.equal(String(notification.body.text).includes('supersecret12345'), false, 'secret is redacted')
  assert.equal(String(notification.body.text).includes('href="javascript'), false, 'unsafe href is not emitted')

  // Malformed origin must be rejected without printing the token.
  harness.config.apiOrigin = 'not a url'
  emit(harness, 'user-questions/request', question('outra pergunta'), async () => {})
  await sleep(200)
  assert.ok(harness.logs.some((entry) => entry.text.includes('apiOrigin is not a valid URL')), 'malformed origin is rejected')
  assert.equal(harness.logs.some((entry) => entry.text.includes(TOKEN) || entry.text.includes('AAH-fake-token')), false, 'token never reaches the log')

  // Plain HTTP to a remote host must be rejected.
  harness.config.apiOrigin = 'http://evil.example'
  harness.calls.length = 0
  emit(harness, 'user-questions/request', question('mais uma'), async () => {})
  await sleep(200)
  assert.ok(harness.logs.some((entry) => entry.text.includes('must use https')), 'remote http origin is rejected')
  assert.equal(harness.calls.some((call) => call.url.startsWith('http://evil.example')), false, 'no request leaves for an http origin')

  // Finished notification: includeResponse stays off by default.
  const session = { id: 'session-2', snapshotEvents: () => [] }
  const agent = { id: 'agent-2', session }
  harness.config.apiOrigin = 'https://api.telegram.org'
  harness.ctx.agents.list = () => [agent]
  harness.calls.length = 0
  emit(harness, 'agent/status', { agent, status: 'running' })
  emit(harness, 'session/event', session, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'a resposta final' }] } } })
  emit(harness, 'session/event', session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  emit(harness, 'agent/status', { agent, status: 'idle' })
  await sleep(200)
  const finished = harness.calls.find((call) => call.body.chat_id === '123' && String(call.body.text ?? '').includes('terminou'))
  assert.ok(finished !== undefined, 'finished notification is sent')
  assert.equal(String(finished.body.text).includes('a resposta final'), false, 'includeResponse is off by default')

  for (const dispose of harness.ctx.disposers) dispose()
}

console.log('security harness: OK')
