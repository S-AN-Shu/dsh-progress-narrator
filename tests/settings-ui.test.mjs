import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsUI } from '../src/settings-ui.js'
import { assertConfig } from '../lib/config.js'

// Exercise the actual section's controls and network calls with deterministic
// state/effect hooks; no DOM, host process or model request is needed.
function fixture({ deferPatch = false } = {}) {
  const hooks = [], queuedEffects = [], calls = [], updates = []
  let cursor = 0, tree, config = assertConfig({}), revision = 0, completePatch
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) {
      const index = cursor++
      hooks[index] ??= { value: initial }
      return [hooks[index].value, next => { hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next }]
    },
    useEffect(effect, deps) {
      const index = cursor++, previous = hooks[index]
      if (previous && deps.every((value, at) => Object.is(value, previous.deps[at]))) return
      hooks[index] = { deps, cleanup: previous?.cleanup }
      queuedEffects.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = effect() })
    },
  }
  const state = () => ({ config, revision, writable: true })
  const runtime = {
    async fetch(url, options = {}) {
      calls.push({ url, ...options })
      if (options.method !== 'PATCH') return Response.json(state())
      const body = JSON.parse(options.body)
      const complete = status => {
        if (status >= 400) return Response.json({ ok: false }, { status })
        assert.equal(body.expectedRevision, revision)
        config = { ...config, ...body.patch }; revision++
        return Response.json(state())
      }
      if (deferPatch) return new Promise(resolve => { completePatch = (status = 200) => resolve(complete(status)) })
      return complete(200)
    },
  }
  const { SettingsSection } = createSettingsUI(React, runtime, value => updates.push(value))
  const render = () => {
    cursor = 0; tree = SettingsSection()
    queuedEffects.splice(0).forEach(effect => effect())
    return tree
  }
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); render() }
  function nodes(node) {
    if (!arguments.length) node = tree
    if (Array.isArray(node)) return node.flatMap(nodes)
    if (!node || typeof node !== 'object') return []
    return [node, ...node.children.flatMap(nodes)]
  }
  const input = label => nodes().find(node => node.props['aria-label'] === label)
  const patches = () => calls.filter(call => call.method === 'PATCH').map(call => JSON.parse(call.body))
  render()
  return { settle, render, input, patches, nodes, updates, completePatch: status => completePatch(status), persisted: () => config }
}

test('master switch persists immediately without submitting the other draft fields', async () => {
  const f = fixture({ deferPatch: true }); await f.settle()
  f.input('无说明时长（秒）').props.onChange({ target: { value: '180' } }); f.render()
  f.input('启用工作说明').props.onChange({ target: { checked: false } }); f.render()
  assert.deepEqual(f.patches(), [{ patch: { enabled: false }, expectedRevision: 0 }])
  assert.equal(f.nodes().find(node => node.type === 'fieldset').props.disabled, true)
  f.completePatch(); await f.settle()
  assert.equal(f.input('启用工作说明').props.checked, false)
  assert.equal(f.input('无说明时长（秒）').props.value, 180)
  assert.equal(f.persisted().narrationIntervalMs, 120000)
  assert.equal(f.updates.at(-1).enabled, false)
  const saving = f.nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  f.completePatch(); await saving; await f.settle()
  assert.deepEqual(f.patches().at(-1), { patch: { narrationIntervalMs: 180000 }, expectedRevision: 1 })
})

test('master switch supports disable and re-enable with the latest revision', async () => {
  const f = fixture(); await f.settle()
  f.input('启用工作说明').props.onChange({ target: { checked: false } }); await f.settle()
  f.input('启用工作说明').props.onChange({ target: { checked: true } }); await f.settle()
  assert.deepEqual(f.patches(), [
    { patch: { enabled: false }, expectedRevision: 0 },
    { patch: { enabled: true }, expectedRevision: 1 },
  ])
  assert.equal(f.persisted().enabled, true)
  assert.equal(f.input('启用工作说明').props.checked, true)
})

test('failed or conflicting master-switch saves restore persisted state and retain other drafts', async () => {
  for (const status of [500, 409]) {
    const f = fixture({ deferPatch: true }); await f.settle()
    f.input('无说明时长（秒）').props.onChange({ target: { value: '180' } }); f.render()
    f.input('启用工作说明').props.onChange({ target: { checked: false } }); f.render()
    assert.equal(f.patches().length, 1)
    f.completePatch(status); await f.settle()
    assert.equal(f.input('启用工作说明').props.checked, true)
    assert.equal(f.input('无说明时长（秒）').props.value, 180)
    assert.equal(f.persisted().enabled, true)
    assert.equal(f.updates.at(-1).enabled, true)
    assert.match(f.nodes().find(node => node.props.role === 'status').children.join(''), status === 409 ? /其他页面更新/ : /保存失败/)
  }
})
