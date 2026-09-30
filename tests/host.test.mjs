import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, Config } from '../lib/index.js'
import { assertConfig, validateConfig } from '../lib/config.js'
function fixture(config = {}) {
  const handlers = new Map(), routes = new Map(), disposers = [], history = []
  const ctx = {
    on(key, fn) { handlers.set(key, fn) }, logger: { warn() {} },
    effect(fn) { const d = fn(); if (d) disposers.push(d) },
    connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } } },
  }
  apply(ctx, config)
  const session = { id: 's', deriveMessages: () => history }, agent = { session }, controller = new AbortController()
  let seq = 0
  const event = (type, data = {}) => { if (type === 'user/message') history.push(data); handlers.get('session/event')(session, { type, data, seq: seq++, time: Date.now() }) }
  event('turn/start', { turn: 1 })
  const step = (args = {}, decision = { kind: 'enter', messages: [{ id: 'human', role: 'user', content: [] }] }) => handlers.get('agent/pre-step')({ agent, turn: 1, step: 1, messages: [], signal: controller.signal, ...args }, async () => decision)
  return { handlers, routes, disposers, history, session, agent, controller, event, step }
}
test('current volatile Config preserves defaults and business validation rejects malformed and unknown fields', () => {
  const defaults = Config['~standard'].validate(undefined).value
  assert.equal(typeof defaults.get, 'function')
  assert.equal(defaults.get().enabled, true)
  assert.equal(defaults.get().showStatusPanel, false)
  assert.equal(Config['~standard'].validate({ showStatusPanel: true }).value.get().showStatusPanel, true)
  for (const value of [null, [], 1, { enabled: 'false' }, { firstNarration: 'true' }, { showStatusPanel: 'false' }, { showStatusPanel: null }, { silentStepThreshold: 1.5 }, { uiTickMs: null }]) {
    if (value !== null && value?.showStatusPanel !== null && value?.uiTickMs !== null) assert.ok(Config['~standard'].validate(value).issues)
    assert.ok(validateConfig(value).issues)
    assert.throws(() => assertConfig(value), TypeError)
  }
  // Null is a default/reset value in the current form schema, but is invalid raw business input.
  assert.deepEqual(Config['~standard'].validate(null).value.get(), defaults.get())
  assert.equal(Config['~standard'].validate({ showStatusPanel: null }).value.get().showStatusPanel, false)
  assert.equal(Config['~standard'].validate({ uiTickMs: null }).value.get().uiTickMs, 1000)
  // Schemastery preserves extra fields; the plugin's strict business boundary rejects them.
  const extra = Config['~standard'].validate({ marker: 'x' }).value.get()
  assert.equal(extra.marker, 'x')
  assert.ok(validateConfig(extra).issues)
  assert.throws(() => assertConfig(extra), /unknown/)
  assert.throws(() => apply({}, { enabled: 'yes' }), /boolean/)
})
test('teach at first legitimate boundary, source version and decision fields preserved', async () => {
  const f = fixture(), result = await f.step({}, { kind: 'enter', messages: [{ id: 'human' }], startsRequestSeries: true })
  assert.equal(result.startsRequestSeries, true); assert.equal(result.messages.length, 2)
  const rule = result.messages.at(-1); assert.equal(rule.source.control, 'teach'); assert.equal(rule.role, 'user')
  f.event('user/message', rule)
  assert.equal((await f.step({ step: 2 }, { kind: 'enter', messages: [] })).messages.length, 0)
})
test('reject, abort and empty admission cannot create a request', async () => {
  const f = fixture(); assert.equal((await f.step({}, { kind: 'reject' })).kind, 'reject')
  assert.deepEqual(await f.step({}, { kind: 'enter', messages: [] }), { kind: 'enter', messages: [] })
  f.controller.abort(); assert.equal((await f.step()).messages.length, 1)
})
test('aborted unaccepted teach is offered on next real request', async () => {
  const f = fixture(); const first = await f.step(); assert.equal(first.messages.length, 2)
  f.controller.abort(); const signal = new AbortController().signal
  assert.equal((await f.step({ signal, step: 2 })).messages.length, 2)
})
test('effective-context compaction causes exactly one teach; no teach/nudge double injection', async () => {
  const f = fixture(); f.event('user/message', (await f.step()).messages.at(-1))
  f.event('assistant/message', { turn: 1, step: 1, message: { id: 'a', content: [] } })
  f.event('assistant/message', { turn: 1, step: 2, message: { id: 'b', content: [] } })
  f.history.length = 0
  const result = await f.step({ step: 3 }, { kind: 'enter', messages: [] })
  assert.equal(result.messages.length, 1); assert.equal(result.messages[0].source.control, 'teach')
})
test('reads are registered only on authenticated Connection and disposed', async () => {
  const f = fixture(); const route = f.routes.get('/api/progress-narrator/state')
  assert.deepEqual(route.methods, ['GET'])
  const response = await route.fetch(new Request('http://test/api/progress-narrator/state?session=s'))
  const body = await response.json(); assert.equal(body.sessionId, 's'); assert.equal(body.session.phase, 'waiting-model')
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal((await route.fetch(new Request('http://test/api/progress-narrator/state'))).status, 400)
  f.disposers.forEach(d => d()); assert.equal(f.routes.size, 0)
})
test('disabled plugin has no state or injection', async () => {
  const f = fixture({ enabled: false }); assert.equal((await f.step()).messages.length, 1)
  const response = await f.routes.get('/api/progress-narrator/state').fetch(new Request('http://test/api/progress-narrator/state?session=s'))
  assert.equal((await response.json()).session, null)
})
