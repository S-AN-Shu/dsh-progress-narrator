import test from 'node:test'
import assert from 'node:assert/strict'
import { foldingPlan, readerOwnsFolding } from '../src/folding.js'
const assistant = (key, step, status = 'settled') => ({ key, kind: 'assistant-step', data: { turn: 1, step, status, blocks: [{ kind: 'reasoning', text: key }] } })
const tool = (key, step, done = true, extra = {}) => ({ key, kind: 'tool-call', location: { turn: { turn: 1 }, step: { step } }, data: { root: { ...(done ? { kind: 'tool-result' } : {}), ...extra } } })
const plan = nodes => foldingPlan({ order: nodes.map(n => n.key), nodes: new Map(nodes.map(n => [n.key, n])) })
test('keeps latest thought, running tools and the last completed batch during thinking', () => {
  const nodes = [assistant('a1', 1), tool('t1', 1), assistant('a2', 2), tool('t2a', 2), tool('t2b', 2), assistant('a3', 3, 'running')]
  let p = plan(nodes)
  assert.deepEqual([...p.reasoning], ['a1', 'a2']); assert.deepEqual([...p.tools], ['t1'])
  p = plan([...nodes, tool('t3', 3, false)])
  assert.deepEqual([...p.tools], ['t1', 't2a', 't2b'])
  p = plan([...nodes, tool('t3', 3), assistant('a4', 4, 'running')])
  assert.deepEqual([...p.tools], ['t1', 't2a', 't2b'])
})
test('running subcalls, failed tools and interrupted reasoning remain visible', () => {
  const nodes = [assistant('a1', 1, 'interrupted'), tool('t1', 1, true, { subCalls: [{ callId: 'running' }] }), tool('error', 1, true, { isError: true }), assistant('a2', 2), tool('t2', 2)]
  const p = plan(nodes); assert.equal(p.reasoning.size, 0); assert.equal(p.tools.size, 0)
})
test('plan does not mutate source or mix turns', () => {
  const nodes = [assistant('a1', 1), { ...assistant('b1', 1), data: { ...assistant('b1', 1).data, turn: 2 } }]
  const before = JSON.stringify(nodes); assert.equal(plan(nodes).reasoning.size, 0); assert.equal(JSON.stringify(nodes), before)
})

test('Reader owns folding whenever its root or flow is mounted', () => {
  const make = () => ({ querySelector: () => ({}) })
  assert.equal(readerOwnsFolding(make()), true)
  assert.equal(readerOwnsFolding(make()), true)
  assert.equal(readerOwnsFolding(make()), true)
  assert.equal(readerOwnsFolding({ querySelector: () => null }), false)
})
