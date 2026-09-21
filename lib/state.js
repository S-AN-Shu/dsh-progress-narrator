/** Public-event reducer: no timers, model calls, tool control or session writes. */
import { scanProgressSpans } from './protocol.js'
export const RULE_VERSION = 3
// A missed reminder must not make the monitor disappear from a long task. Keep
// the quiet baseline configurable, but cap exponential backoff at 2x it
// (120s default -> at most 240s between accepted reminders).
export const MAX_BACKOFF_FACTOR = 2
export const ENGINE_DEFAULTS = { silentStepThreshold: 6, narrationIntervalMs: 120000, minNudgeIntervalMs: 120000, maxNudgesPerTurn: 0, triggerMode: 'either', backoffEnabled: true }
export function createNarrationEngine({ config = {}, now = Date.now } = {}) {
  const cfg = { ...ENGINE_DEFAULTS, ...config }, sessions = new Map()
  function stateOf(id) {
    if (!sessions.has(id)) sessions.set(id, { id, turn: null, phase: 'unknown', phaseStartedAt: null, lastSeenAt: now(), lastSeq: -1, silentSteps: 0, seenSteps: new Set(), activeCalls: new Map(), approvals: new Set(), narrations: [], lastNarrationAt: null, lastActivityAt: null, ruleEpoch: 0, pending: null, stream: null, streamRevision: -1, terminalReason: null })
    return sessions.get(id)
  }
  function phase(s, p, at) { if (s.phase !== p) { s.phase = p; s.phaseStartedAt = at } }
  function activity(s, at) { s.lastActivityAt = Math.max(s.lastActivityAt ?? at, at) }
  function settle(s, at) { phase(s, s.approvals.size ? 'waiting-approval' : s.activeCalls.size ? 'waiting-tool' : 'waiting-model', at) }
  function open(s, turn, at) {
    s.turn = { turn, startedAt: at, narratedAt: null, nudges: 0, unansweredNudges: 0, lastNudgeAt: null, decisionReason: 'not-due' }
    s.silentSteps = 0; s.seenSteps.clear(); s.activeCalls.clear(); s.approvals.clear()
    s.pending = null; s.stream = null; s.terminalReason = null
    phase(s, 'waiting-model', at); activity(s, at)
  }
  function observeEvent(id, e) {
    if (!id || !e) return
    const s = stateOf(id), d = e.data ?? {}, at = Number.isFinite(e.time) ? Math.min(e.time, now()) : now()
    if (Number.isInteger(e.seq)) { if (e.seq <= s.lastSeq) return; s.lastSeq = e.seq }
    s.lastSeenAt = now()
    if (e.surfaceOp && e.surfaceOp !== 'append') return
    if (e.type === 'turn/start') { open(s, d.turn, at); return }
    if (e.type === 'user/message' && d.source?.kind === 'progress-narrator') {
      if (s.pending?.id === d.id) {
        if (s.pending.kind === 'nudge' && s.turn) { s.turn.nudges++; s.turn.unansweredNudges++; s.turn.lastNudgeAt = at }
        s.pending = null
      }
      return
    }
    if (e.type.startsWith('compaction/')) { if (e.type === 'compaction/end') { s.ruleEpoch++; s.pending = null }; return }
    if (!s.turn || (d.turn != null && d.turn !== s.turn.turn)) return
    switch (e.type) {
      case 'turn/end':
        s.terminalReason = d.reason?.kind ?? d.reason ?? 'unknown'
        phase(s, ({ completed: 'completed', error: 'failed', aborted: 'stopped', interrupted: 'stopped', blocked: 'blocked', 'max-tokens': 'incomplete' })[s.terminalReason] ?? 'unknown', at)
        s.turn = null; s.pending = null; s.stream = null; s.activeCalls.clear(); s.approvals.clear(); return
      case 'tool/call':
        if (d.callId) s.activeCalls.set(d.callId, { name: d.name || '工具', startedAt: at })
        settle(s, at); break
      case 'tool/result': {
        const callId = d.message?.source?.callId ?? d.message?.content?.find(b => b.type === 'tool-result')?.toolCallId
        if (callId) s.activeCalls.delete(callId)
        settle(s, at); break
      }
      case 'approval/asked': if (d.id) s.approvals.add(d.id); settle(s, at); break
      case 'approval/decided': s.approvals.delete(d.id); settle(s, at); break
      case 'assistant/message': {
        const key = `${d.turn}:${d.step}`
        if (s.seenSteps.has(key)) return
        s.seenSteps.add(key)
        const spans = collectNarrations(d.message)
        spans.forEach(span => s.narrations.push({ ...span, id: `${d.message?.id ?? e.seq}:${span.blockIndex}:${span.start}`, turn: d.turn, step: d.step, at, interrupted: d.interrupted === true }))
        s.narrations = s.narrations.slice(-100)
        if (spans.length) { s.lastNarrationAt = at; s.turn.narratedAt = at; s.turn.unansweredNudges = 0; s.silentSteps = 0 }
        else if (!d.interrupted) s.silentSteps++
        s.stream = null; settle(s, at); break
      }
      case 'assistant/attempt': s.stream = null; settle(s, at); break
      case 'llm/retry': case 'llm/retry-started': phase(s, 'retry', at); break
      case 'step/start': settle(s, at); break
      case 'step/end': case 'user/message': break
      default: return
    }
    activity(s, at)
  }
  function observeStreamFrame(id, f) {
    if (!id || !f) return
    const s = stateOf(id)
    if (!s.turn || !Number.isInteger(f.revision) || f.revision <= s.streamRevision) return
    if (f.type === 'start') {
      if (f.turn !== s.turn.turn) return
      s.streamRevision = f.revision
      s.stream = { attemptId: f.attemptId, revision: f.revision, index: -1 }
      settle(s, now()); return
    }
    const stream = s.stream
    if (!stream || f.attemptId !== stream.attemptId || f.index <= stream.index) return
    s.streamRevision = f.revision
    stream.index = f.index
    if (f.type === 'end') { s.stream = null; settle(s, now()); return }
    if (f.type !== 'chunk') return
    const c = f.chunk ?? {}, at = Number.isFinite(f.time) ? Math.min(f.time, now()) : now()
    if (['text-delta', 'reasoning-delta', 'tool-call-delta', 'block-end'].includes(c.type)) {
      activity(s, at)
      if (!s.activeCalls.size && !s.approvals.size) phase(s, 'receiving-model', at)
    }
    s.lastSeenAt = now()
  }
  function beginPreStep(id, { turn, rulesPresent = false } = {}) {
    const s = stateOf(id), t = s.turn
    const result = (reason, teach = false, nudge = false) => { if (t) t.decisionReason = reason; return { teach, nudge } }
    if (!t || t.turn !== turn) return result('inactive')
    if (s.approvals.size) return result('approval')
    if (s.pending) return result('pending')
    if (!rulesPresent) return result('teach', true)
    const elapsed = now() - (t.narratedAt ?? t.startedAt)
    const timeDue = elapsed >= cfg.narrationIntervalMs, stepsDue = s.silentSteps >= cfg.silentStepThreshold
    const due = cfg.triggerMode === 'time' ? timeDue : cfg.triggerMode === 'steps' ? stepsDue : cfg.triggerMode === 'both' ? timeDue && stepsDue : timeDue || stepsDue
    if (!due) return result('not-due')
    if (cfg.maxNudgesPerTurn > 0 && t.nudges >= cfg.maxNudgesPerTurn) return result('turn-limit')
    // Guard the first reminder and every fresh narration as well as prior nudges.
    // Unanswered reminders slow down after two attempts, capped at 4x the interval.
    const factor = cfg.backoffEnabled ? Math.min(MAX_BACKOFF_FACTOR, 2 ** Math.min(2, Math.max(0, t.unansweredNudges - 1))) : 1
    const anchor = Math.max(t.narratedAt ?? t.startedAt, t.lastNudgeAt ?? t.startedAt)
    if (now() - anchor < cfg.minNudgeIntervalMs * factor) return result(factor > 1 ? 'backoff' : 'cooldown')
    return result('due', false, true)
  }

  function reserveInjection(id, messageId, kind) { stateOf(id).pending = { id: messageId, kind } }
  function releaseInjection(id, messageId) { const s = sessions.get(id); if (s?.pending?.id === messageId) s.pending = null }
  function attach(id, { turn = null, startedAt = now(), running = false } = {}) {
    const s = stateOf(id)
    if (running && turn !== null && !s.turn) { open(s, turn, startedAt); phase(s, 'unknown', now()); s.lastActivityAt = null }
  }
  function endLifecycle(id) {
    const s = sessions.get(id)
    if (!s) return
    s.turn = null; s.pending = null; s.stream = null; s.streamRevision = -1; s.activeCalls.clear(); s.approvals.clear(); phase(s, 'unknown', now())
  }
  function snapshot(id) {
    const s = sessions.get(id)
    if (!s) return null
    return { sessionId: id, phase: s.phase, phaseStartedAt: s.phaseStartedAt, turn: s.turn?.turn ?? null, turnActive: s.turn !== null, terminalReason: s.terminalReason, turnStartedAt: s.turn?.startedAt ?? null, waitingFor: s.activeCalls.size ? { kind: 'tool', names: [...s.activeCalls.values()].map(c => c.name) } : null, silentSteps: s.silentSteps, nudgesThisTurn: s.turn?.nudges ?? 0, unansweredNudges: s.turn?.unansweredNudges ?? 0, lastNudgeAt: s.turn?.lastNudgeAt ?? null, decisionReason: s.turn?.decisionReason ?? 'inactive', lastNarrationAt: s.lastNarrationAt, lastNarration: s.narrations.at(-1) ?? null, lastActivityAt: s.lastActivityAt, narrationAnchorAt: s.turn ? s.turn.narratedAt ?? s.turn.startedAt : null, activeTools: [...s.activeCalls.values()], approvals: s.approvals.size, narrations: s.narrations.slice(), ruleEpoch: s.ruleEpoch }
  }
  function gc() {
    const idle = [...sessions.entries()].filter(([, s]) => !s.turn).sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt)
    const removed = idle.slice(0, Math.max(0, idle.length - 200)).map(([id]) => id)
    removed.forEach(id => sessions.delete(id))
    return removed
  }
  return { updateConfig: next => Object.assign(cfg, next), observeEvent, observeStreamFrame, beginPreStep, reserveInjection, releaseInjection, attach, endLifecycle, snapshot, gc, disposeSession: id => sessions.delete(id), dispose: () => sessions.clear(), defaults: { ...cfg } }
}
/** Adjacent text blocks share Markdown context, never across a non-text block. */
export function collectNarrations(message) {
  const content = message?.content ?? [], spans = []
  for (let i = 0; i < content.length; i++) {
    if (content[i]?.type !== 'text') continue
    const blockIndex = i
    let text = content[i].text ?? ''
    while (content[i + 1]?.type === 'text') text += content[++i].text ?? ''
    spans.push(...scanProgressSpans(text).map(span => ({ ...span, blockIndex })))
  }
  return spans
}
