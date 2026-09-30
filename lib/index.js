/** Host plugin. Observes public events; only appends control input at an existing request boundary. */
import { randomUUID, createHash } from 'node:crypto'
import { RULE_VERSION, createNarrationEngine } from './state.js'
import { buildRules } from './rules.js'
import { Config, assertConfig, validateConfig, SettingsSchema } from './config.js'
export { Config } from './config.js'
export const name = 'dsh-progress-narrator'
export const inject = ['connection']
export const VERSION = '0.3.0'
const ruleIn = (messages, key) => [...messages].reverse().find(m => m.source?.kind === 'progress-narrator' && m.source?.control === 'teach')?.source?.ruleKey === key
export function apply(ctx, config) {
  const snapshotConfig = () => assertConfig(typeof config?.get === 'function' ? config.get() : config)
  const base = snapshotConfig()
  let cfg = base, provider = null, rules, ruleKey
  const engine = createNarrationEngine({ config: cfg })
  function configure(value) {
    cfg = assertConfig(value)
    engine.updateConfig(cfg)
    rules = buildRules(cfg)
    ruleKey = createHash('sha256').update(`${RULE_VERSION}:${rules.teach}`).digest('hex').slice(0, 20)
  }
  configure(base)
  ctx.inject?.(['settings'], settingsCtx => {
    const service = settingsCtx.settings
    provider = service
    configure(snapshotConfig())
    settingsCtx.on('settings/document-updated', ns => { if (ns === 'progress-narrator') configure(snapshotConfig()) })
    settingsCtx.effect(() => () => { if (provider === service) { provider = null; configure(base) } })
  })
  const identities = new Map(), reservations = new Map()
  let warned = false
  function safe(fn) { try { return fn() } catch { if (!warned) { warned = true; ctx.logger?.warn?.('[progress-narrator] observer failed; task execution is unchanged') } } }
  function bind(session) {
    if (identities.has(session.id) && identities.get(session.id) !== session) engine.disposeSession(session.id)
    identities.set(session.id, session)
  }
  function release(id) {
    const r = reservations.get(id)
    if (!r) return
    r.signal?.removeEventListener('abort', r.onAbort)
    engine.releaseInjection(id, r.messageId)
    reservations.delete(id)
  }
  ctx.on('session/event', (session, event) => {
    if (!session || !event) return
    safe(() => {
      bind(session)
      engine.observeEvent(session.id, event)
      if (event.type === 'turn/end' || (event.type === 'user/message' && event.data.id === reservations.get(session.id)?.messageId)) release(session.id)
      for (const id of engine.gc()) identities.delete(id)
    })
  })
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (!cfg.enabled || !agent?.session) return
    safe(() => { bind(agent.session); engine.observeStreamFrame(agent.session.id, frame) })
  })
  ctx.on('agent/created', ({ agent }) => { if (agent?.session) { bind(agent.session); engine.endLifecycle(agent.session.id) } })
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle' && agent?.session && engine.snapshot(agent.session.id)?.turnActive) { release(agent.session.id); engine.endLifecycle(agent.session.id) }
  })
  ctx.on('agent/disposed', ({ agent }) => {
    if (agent?.session) { release(agent.session.id); engine.endLifecycle(agent.session.id) }
  })
  ctx.on('session/disposed', session => { if (session) { release(session.id); identities.delete(session.id); engine.disposeSession(session.id) } })
  ctx.on('agent/pre-step', async ({ agent, turn, step, messages: incoming = [], signal }, next) => {
    const decision = await next()
    if (!cfg.enabled || decision?.kind !== 'enter' || signal?.aborted || !agent?.session) return decision
    // Same admission guard used by the host's model-switch notice: an empty first
    // batch (or a stripped inbox batch) must never be turned into a new request.
    if (!decision.messages.length && (step === 1 || incoming.length > 0)) return decision
    try {
      const session = agent.session
      bind(session)
      release(session.id) // any unaccepted reservation from the previous boundary
      engine.attach(session.id, { turn, running: true })
      const history = session.deriveMessages()
      const intent = engine.beginPreStep(session.id, { turn, rulesPresent: !decision.startsRequestSeries && (ruleIn([...history, ...decision.messages], ruleKey)) })
      if (!intent.teach && !intent.nudge) return decision
      const kind = intent.teach ? 'teach' : 'nudge'
      const message = {
        id: `progress-narrator/${session.id}/${turn}/${step}/${randomUUID()}`,
        role: 'user', content: [{ type: 'text', text: intent.teach ? rules.teach : rules.nudge }],
        source: { kind: 'progress-narrator', form: 'notice', summary: intent.teach ? '进度播报规则' : '进度播报提醒', ruleVersion: RULE_VERSION, ruleKey, control: kind },
      }
      engine.reserveInjection(session.id, message.id, kind)
      const onAbort = () => release(session.id)
      reservations.set(session.id, { messageId: message.id, signal, onAbort })
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) { release(session.id); return decision }
      return { ...decision, messages: [...decision.messages, message] }
    } catch { return decision }
  })
  // Exact /api routes use the host Connection's Host/Origin fence and signed-cookie
  // authentication, including remote deployments. No unauthenticated WebServer route.
  const response = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/progress-narrator/state', methods: ['GET'], requestBody: 'buffered',
    fetch: async request => {
      const id = new URL(request.url).searchParams.get('session')
      if (!id || id.length > 512) return response({ ok: false, reason: 'invalid-session' }, 400)
      return response({ ok: true, version: VERSION, ruleVersion: RULE_VERSION, serverTime: Date.now(), sessionId: id, config: cfg, session: cfg.enabled ? engine.snapshot(id) : null })
    },
  }), 'progress-narrator: authenticated state')
  const settingsState = () => {
    const descriptor = provider?.describe({ redactSecrets: true }).find(d => d.ns === 'progress-narrator')
    return { ok: true, version: VERSION, config: cfg, writable: !!provider?.writable, revision: descriptor?.revision ?? null }
  }
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/progress-narrator/settings', methods: ['GET', 'PATCH'], requestBody: 'buffered',
    fetch: async request => {
      if (request.method === 'GET') return response(settingsState())
      if (!provider?.writable) return response({ ok: false, reason: 'settings-unavailable' }, 503)
      try {
        const raw = await request.text()
        if (raw.length > 16000) return response({ ok: false, reason: 'too-large' }, 413)
        const body = JSON.parse(raw)
        if (!body || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || !body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) return response({ ok: false, reason: 'invalid-request' }, 400)
        const parsed = validateConfig(body.patch, true)
        if (parsed.issues) return response({ ok: false, reason: 'invalid-settings', issues: parsed.issues }, 400)
        await provider.update('progress-narrator', parsed.value, body.expectedRevision)
        configure(snapshotConfig())
        return response(settingsState())
      } catch (error) {
        return response({ ok: false, reason: error?.code === 'SETTINGS_CONFLICT' ? 'settings-conflict' : 'settings-write-failed' }, error?.code === 'SETTINGS_CONFLICT' ? 409 : 400)
      }
    },
  }), 'progress-narrator: authenticated settings')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/progress-narrator/health', methods: ['GET'], requestBody: 'buffered',
    fetch: async () => response({ ok: true, version: VERSION, ruleVersion: RULE_VERSION }),
  }), 'progress-narrator: authenticated health')
  ctx.effect(() => () => { for (const id of reservations.keys()) release(id); identities.clear(); engine.dispose() }, 'progress-narrator: state disposal')
}
export default { name, inject, Config, apply }
