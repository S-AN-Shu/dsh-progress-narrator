import test from 'node:test'
import assert from 'node:assert/strict'
import { createNarrationEngine } from '../lib/state.js'
function fixture(config = {}) {
  let clock = 1000, seq = 0
  const engine = createNarrationEngine({ config: { firstNarration: false, ...config }, now: () => clock })
  const event = (type, data = {}, extra = {}) => engine.observeEvent('s', { type, data, seq: seq++, time: clock, ...extra })
  const next = extra => engine.beginPreStep('s', { turn: 1, rulesPresent: true, ...extra })
  const message = (step, text = '', extra = {}) => event('assistant/message', { turn: 1, step, message: { id: `m${step}`, content: [{ type: 'text', text }] }, ...extra })
  event('turn/start', { turn: 1 })
  return { engine, event, next, message, advance: ms => clock += ms, snap: () => engine.snapshot('s') }
}
test('real tool/result source.callId settles the pending tool', () => {
  const f = fixture(); f.event('tool/call', { turn: 1, callId: 'call', name: 'test' })
  assert.equal(f.snap().phase, 'waiting-tool')
  f.event('tool/result', { turn: 1, message: { source: { kind: 'tool', callId: 'call' } } })
  assert.equal(f.snap().activeTools.length, 0); assert.equal(f.snap().phase, 'waiting-model')
})
test('turn counters and explanation anchor never leak into the next turn', () => {
  const f = fixture(); f.message(1, '## 📌 进度：完成第一部分'); f.message(2); f.message(3)
  f.event('turn/end', { turn: 1, reason: { kind: 'completed' } }); f.advance(90000); f.event('turn/start', { turn: 2 })
  assert.equal(f.snap().silentSteps, 0); assert.equal(f.snap().narrationAnchorAt, 91000)
  assert.deepEqual(f.next({ turn: 2 }), { teach: false, nudge: false })
})
test('teach is available on first request and merges with an overdue nudge', () => {
  const f = fixture(); f.advance(125000)
  assert.deepEqual(f.next({ rulesPresent: false }), { teach: true, nudge: false })
})
test('first silent assistant step gets one immediate narration reminder', () => {
  const f = fixture({ firstNarration: true }); f.message(1)
  assert.deepEqual(f.next(), { teach: false, nudge: true })
  f.engine.reserveInjection('s', 'first', 'nudge')
  f.event('user/message', { id: 'first', source: { kind: 'progress-narrator' } })
  f.message(2)
  assert.deepEqual(f.next(), { teach: false, nudge: false })
})
test('only accepted control messages consume nudge budget; own control is not activity', () => {
  const f = fixture(); f.message(1); f.message(2); f.advance(125000)
  assert.equal(f.next().nudge, true)
  f.engine.reserveInjection('s', 'n1', 'nudge'); assert.equal(f.snap().nudgesThisTurn, 0)
  const previousActivity = f.snap().lastActivityAt
  f.event('user/message', { id: 'n1', source: { kind: 'progress-narrator' } })
  assert.equal(f.snap().nudgesThisTurn, 1); assert.equal(f.snap().lastActivityAt, previousActivity)
  assert.equal(f.next().nudge, false)
  f.advance(120000); assert.equal(f.next().nudge, true)
})
test('cancelled reservation is retryable and never counted', () => {
  const f = fixture(); f.advance(125000); f.engine.reserveInjection('s', 'pending', 'nudge')
  assert.equal(f.next().nudge, false); f.engine.releaseInjection('s', 'pending')
  assert.equal(f.next().nudge, true); assert.equal(f.snap().nudgesThisTurn, 0)
})
test('per-turn cap applies to accepted nudges', () => {
  const f = fixture({ maxNudgesPerTurn: 2, minNudgeIntervalMs: 0 }); f.advance(125000)
  for (let i = 0; i < 2; i++) { assert.equal(f.next().nudge, true); f.engine.reserveInjection('s', `n${i}`, 'nudge'); f.event('user/message', { id: `n${i}`, source: { kind: 'progress-narrator' } }) }
  assert.equal(f.next().nudge, false)
})
test('approval suppresses teach and nudge and is cleared at end', () => {
  const f = fixture(); f.event('approval/asked', { id: 'approval' }); f.advance(125000)
  assert.deepEqual(f.next({ rulesPresent: false }), { teach: false, nudge: false })
  f.event('turn/end', { turn: 1, reason: { kind: 'aborted' } }); assert.equal(f.snap().approvals, 0); assert.equal(f.snap().phase, 'stopped')
})
test('event replay, repeated step and replacement copies do not duplicate narration', () => {
  const f = fixture(); f.message(1, '## 📌 进度：已完成'); f.message(1, '## 📌 进度：已完成')
  f.message(2, '## 📌 进度：不应新增', { }); f.event('assistant/message', { turn: 1, step: 3, message: { content: [{ type: 'text', text: '## 📌 进度：副本' }] } }, { surfaceOp: { op: 'replace', start: 1, end: 1 } })
  assert.equal(f.snap().narrations.length, 2)
  f.engine.observeEvent('s', { seq: 1, type: 'assistant/message', data: { turn: 1, step: 4 } }); assert.equal(f.snap().silentSteps, 0)
})
test('stream revision/index dedup and receiving-model reset retry', () => {
  const f = fixture(); f.event('llm/retry-started', {}); assert.equal(f.snap().phase, 'retry')
  f.engine.observeStreamFrame('s', { type: 'start', attemptId: 'a', revision: 1, turn: 1, step: 1 })
  f.advance(1000); const frame = { type: 'chunk', attemptId: 'a', revision: 2, index: 0, time: 2000, chunk: { type: 'reasoning-delta', text: 'working', index: 0 } }
  f.engine.observeStreamFrame('s', frame); assert.equal(f.snap().phase, 'receiving-model')
  f.advance(5000); f.engine.observeStreamFrame('s', { ...frame, time: 7000 }); assert.equal(f.snap().lastActivityAt, 2000)
  f.engine.observeStreamFrame('s', { ...frame, attemptId: 'old', revision: 3, index: 10, time: 7000 }); assert.equal(f.snap().lastActivityAt, 2000)
  f.engine.observeStreamFrame('s', { ...frame, revision: 3, index: 1, time: 7000 }); assert.equal(f.snap().lastActivityAt, 7000)
  f.engine.observeStreamFrame('s', { type: 'end', attemptId: 'a', revision: 4, index: 2 }); assert.equal(f.snap().phase, 'waiting-model')
})
test('terminal event preserves progress and stops activity; late old frames ignored', () => {
  const f = fixture(); f.message(1, '## 📌 进度：已确认结果', { interrupted: true }); f.event('turn/end', { turn: 1, reason: { kind: 'error' } })
  assert.equal(f.snap().turnActive, false); assert.equal(f.snap().phase, 'failed'); assert.equal(f.snap().narrations.length, 1)
  const at = f.snap().lastActivityAt; f.advance(5000); f.engine.observeStreamFrame('s', { type: 'chunk', time: 6000 })
  assert.equal(f.snap().lastActivityAt, at)
})
test('Markdown context spans adjacent text blocks without crossing reasoning', () => {
  const f = fixture(); f.event('assistant/message', { turn: 1, step: 1, message: { id: 'mixed', content: [{ type: 'text', text: '```\n' }, { type: 'text', text: '## 📌 进度：假\n```\n' }, { type: 'reasoning', text: 'x' }, { type: 'text', text: '## 📌 进度：真' }] } })
  assert.deepEqual(f.snap().narrations.map(n => n.text), ['真'])
})
test('session lifecycle replacement clears pending work, unknown resume does not invent activity', () => {
  const f = fixture(); f.engine.endLifecycle('s'); f.engine.attach('s', { running: true, turn: 2 })
  assert.equal(f.snap().phase, 'unknown'); assert.equal(f.snap().lastActivityAt, null)
  f.engine.disposeSession('s'); assert.equal(f.snap(), null)
})
test('sessions do not share state', () => {
  const f = fixture(); f.message(1, '## 📌 进度：主任务'); f.engine.observeEvent('child', { type: 'turn/start', data: { turn: 1 } })
  assert.equal(f.engine.snapshot('child').narrations.length, 0)
})

test('default cadence survives long work and backs off only unanswered reminders', () => {
  const f = fixture(); for (let i = 1; i <= 20; i++) f.message(i)
  f.advance(119999); assert.equal(f.next().nudge, false); assert.equal(f.snap().decisionReason, 'cooldown')
  f.advance(1); assert.equal(f.next().nudge, true)
  const accept = id => { f.engine.reserveInjection('s', id, 'nudge'); f.event('user/message', { id, source: { kind: 'progress-narrator' } }) }
  accept('n1'); f.advance(120000); assert.equal(f.next().nudge, true); accept('n2')
  f.advance(120000); assert.equal(f.next().nudge, false); assert.equal(f.snap().decisionReason, 'backoff')
  f.advance(120000); assert.equal(f.next().nudge, true); accept('n3')
  f.advance(240000); assert.equal(f.next().nudge, true); accept('n4')
  assert.equal(f.snap().nudgesThisTurn, 4)
  f.message(21, '📌 进度：检查已完成，接着验证边界。')
  assert.equal(f.snap().unansweredNudges, 0)
  f.advance(119999); assert.equal(f.next().nudge, false)
  f.advance(1); assert.equal(f.next().nudge, true)
 })
test('unanswered reminder backoff is capped at two times the configured interval', () => {
  const f = fixture({ minNudgeIntervalMs: 120000 })
  f.advance(120000); assert.equal(f.next().nudge, true)
  const accept = id => { f.engine.reserveInjection('s', id, 'nudge'); f.event('user/message', { id, source: { kind: 'progress-narrator' } }) }
  accept('n1')
  f.advance(120000); assert.equal(f.next().nudge, true); accept('n2')
  f.advance(239999); assert.equal(f.next().nudge, false)
  f.advance(1); assert.equal(f.next().nudge, true); accept('n3')
  f.advance(240000); assert.equal(f.next().nudge, true)
})
test('successful narrations allow reminders throughout 100 steps without flooding', () => {
  const f = fixture(); let nudges = 0
  for (let step = 1; step <= 100; step++) {
    f.advance(30000)
    if (f.next().nudge) {
      const id = 'n' + step; nudges++
      f.engine.reserveInjection('s', id, 'nudge'); f.event('user/message', { id, source: { kind: 'progress-narrator' } })
      f.message(step, '📌 进度：这一阶段已确认，继续核对下一项。')
    } else f.message(step)
  }
  assert.equal(nudges, 25)
})
test('runtime frequency updates and all four trigger modes apply without lifecycle reset', () => {
  for (const triggerMode of ['either', 'time', 'steps', 'both']) {
    const f = fixture({ triggerMode, minNudgeIntervalMs: 1000 })
    f.message(1); f.advance(1000)
    f.engine.updateConfig({ silentStepThreshold: 1 })
    assert.equal(f.next().nudge, ['either', 'steps'].includes(triggerMode))
    f.advance(120000); assert.equal(f.next().nudge, true)
    assert.equal(f.snap().silentSteps, 1)
  }
})
