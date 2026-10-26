import test from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '../src/client.js'
import { installToolFolding } from '../src/tool-fold.js'
import * as protocol from '../lib/protocol.js'

function renderReasoning(extra = {}, reader = false) {
  const Native = function Native() {}
  const React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useSyncExternalStore: (_subscribe, read) => read(),
    useRef: () => ({ current: null }),
    useState: initial => [reader && initial === false ? true : initial, () => {}],
    useLayoutEffect: () => {},
    useEffect: () => {},
  }
  const nodes = [1, 2].map(step => ({
    key: `a${step}`, kind: 'assistant-step',
    data: { turn: 1, step, status: 'settled', blocks: [{ kind: 'reasoning', text: `reason ${step}` }] },
  }))
  const chat = { order: nodes.map(node => node.key), nodes: new Map(nodes.map(node => [node.key, node])) }
  const client = createClient(React, protocol, { document: { querySelector: () => null } })
  const result = client.wrapAssistant(Native)({ node: nodes[0], useChat: select => select(chat), ...extra })
  const elements = []
  const resolve = value => {
    if (Array.isArray(value)) { value.forEach(resolve); return }
    if (!value || typeof value !== 'object') return
    if (typeof value.type === 'function' && value.type !== Native) { resolve(value.type(value.props)); return }
    elements.push(value)
    resolve(value.props?.children)
  }
  resolve(result)
  return { folds: elements.filter(value => value.type === 'details' && value.props['data-pn-fold']), natives: elements.filter(value => value.type === Native) }
}

test('native verbose presentation keeps reasoning free of narrator fallback folds', () => {
  const result = renderReasoning({ usePresentation: select => select({ foldCompletedTurns: false, stepGrouping: 'none' }) })
  assert.equal(result.folds.length, 0)
  assert.equal(result.natives.length, 1)
})

test('native Turn ownership delegates even when its current policy is not foldable', () => {
  assert.equal(renderReasoning({ turnProcess: { foldable: false, open: true } }).folds.length, 0)
})

test('native compact reasoning groups use only the native disclosure', () => {
  const result = renderReasoning({ groupPart: 'reasoning', turnProcess: { foldable: true, open: false } })
  assert.equal(result.folds.length, 0)
  assert.equal(result.natives[0].props.turnProcess.open, false)
})

test('legacy renderer without native presentation still folds earlier reasoning', () => {
  const result = renderReasoning()
  assert.equal(result.folds.length, 1)
  assert.equal(result.folds[0].props.open, false)
})

test('a mounted Reader remains the only folding owner', () => {
  assert.equal(renderReasoning({}, true).folds.length, 0)
})

function toolFixture({ nativeGroup = false, turnMember = false, autoInstall = true } = {}) {
  const attrs = new Set(turnMember ? ['data-turn-process-member'] : [])
  const buttons = []
  const row = {
    dataset: { chatFlowKey: 'tool-1' }, isConnected: true, nativeGroup,
    closest: selector => selector === '[data-step-process]' && row.nativeGroup ? {} : null,
    hasAttribute: name => attrs.has(name),
    removeAttribute: name => attrs.delete(name),
    toggleAttribute: (name, enabled) => enabled ? attrs.add(name) : attrs.delete(name),
    prepend: button => buttons.push(button),
    contains: () => false,
  }
  const scope = { querySelectorAll: () => [row] }
  const document = {
    defaultView: { MutationObserver: class { observe() {} disconnect() {} } },
    getSelection: () => null,
    addEventListener() {}, removeEventListener() {},
    createElement: () => {
      const attributes = new Map()
      const button = {
        dataset: {}, addEventListener() {},
        getAttribute: name => attributes.get(name),
        setAttribute: (name, value) => attributes.set(name, value),
        remove: () => buttons.splice(buttons.indexOf(button), 1),
      }
      return button
    },
  }
  const host = { closest: () => scope }
  const controller = autoInstall ? installToolFolding(document, host, () => new Set(['tool-1']), () => true) : undefined
  return { row, attrs, buttons, controller, document, host }
}

test('native Step groups keep tool folding ownership in verbose and compact modes', () => {
  for (const options of [{ nativeGroup: true }, { nativeGroup: true, turnMember: true }, { turnMember: true }]) {
    const fixture = toolFixture(options)
    assert.equal(fixture.buttons.length, 0)
    assert.equal(fixture.attrs.has('data-pn-tool-collapsed'), false)
    fixture.controller.dispose()
  }
})

test('legacy tool fallback is removed when a native Step group takes ownership', async () => {
  const fixture = toolFixture()
  assert.equal(fixture.buttons.length, 1)
  assert.equal(fixture.attrs.has('data-pn-tool-collapsed'), true)
  fixture.row.nativeGroup = true
  fixture.controller.refresh()
  await Promise.resolve()
  assert.equal(fixture.buttons.length, 0)
  assert.equal(fixture.attrs.has('data-pn-tool-collapsed'), false)
  fixture.controller.dispose()
})

test('native controller capability prevents legacy folds on ungrouped historical tool rows', async () => {
  const fixture = toolFixture({ autoInstall: false })
  const refs = []
  const React = {
    createElement: (type, props) => ({ type, props }),
    useSyncExternalStore: (_subscribe, read) => read(),
    useRef: initial => { const ref = { current: refs.length === 0 ? fixture.host : initial }; refs.push(ref); return ref },
    useEffect: effect => { effect() },
  }
  let entries = [{ options: { key: 'tool-call' }, registrant: '@deepseek-ai/dsh-client-ui-tool' }, { options: { key: 'turn-process' } }]
  const client = createClient(React, protocol, { document: { ...fixture.document, querySelector: () => null } })
  client.apply({ slots: { entries: () => entries, inject() {} }, effect() {} })
  const nodes = [1, 2].map(step => ({ key: `tool-${step}`, kind: 'tool-call', data: { root: { kind: 'tool-result', step } } }))
  const chat = { order: nodes.map(node => node.key), nodes: new Map(nodes.map(node => [node.key, node])) }
  client.ToolFoldController({ sessionId: 's', useChat: select => select(chat) })
  await Promise.resolve()
  assert.equal(fixture.buttons.length, 0)
  entries = entries.filter(entry => entry.options.key !== 'turn-process')
  refs[1].current.refresh()
  await Promise.resolve()
  assert.equal(fixture.buttons.length, 1)
  refs[1].current.dispose()
})

function alphaReasoningFixture() {
  const React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useSyncExternalStore: (_subscribe, read) => read(),
    useRef: () => ({ current: null }),
    useState: initial => [initial, () => {}],
    useLayoutEffect() {}, useEffect() {},
  }
  const bodySlot = 'conversation.chat.reasoning.body'
  function DefaultReasoningBody({ text, running, renderFactorySlot }) {
    return renderFactorySlot('conversation.chat.reasoning.content', { text, running })
  }
  const Native = props => React.createElement('native', {}, props.node.data.blocks.map(block =>
    block.kind === 'reasoning' ? props.renderSlot(bodySlot, { text: block.text, running: false }) : block.text))
  const native = {
    component: Native, options: { key: 'assistant-step' }, locale: 'chat',
    registrant: '@deepseek-ai/dsh-client-ui-chat',
    children: { [bodySlot]: { kind: 'single', scope: 'session' } },
  }
  const defaultBody = { component: DefaultReasoningBody, options: { priority: 100 }, registrant: native.registrant }
  const entries = new Map([['conversation.chat.node', [native]], [bodySlot, [defaultBody]]])
  const listeners = new Map(), disposers = []
  const client = createClient(React, protocol, { document: { querySelector: () => null, documentElement: { style: { setProperty() {} }, setAttribute() {}, removeAttribute() {} } } })
  const slots = {
    entries: name => entries.get(name) ?? [],
    subscribe: (name, listener) => { const group = listeners.get(name) ?? new Set(); group.add(listener); listeners.set(name, group); return () => group.delete(listener) },
    inject: (name, install) => { if (name === 'conversation.chat.node') disposers.push(install()) },
    register(options, component) {
      for (const name of Object.keys(options.children ?? {})) assert.equal(entries.has(name), false, 'a child slot cannot be declared twice')
      const entry = { options, component, ...options.locale ? { locale: options.locale } : {}, ...options.inject ? { inject: options.inject } : {} }
      const group = entries.get(options.name) ?? []; group.push(entry); entries.set(options.name, group)
      return () => group.splice(group.indexOf(entry), 1)
    },
  }
  client.apply({ slots, effect() {} })
  const node = { key: 'alpha', data: { step: 1, blocks: [{ kind: 'reasoning', text: '完整原文思考' }, { kind: 'text', text: '正文\n\n📌 进度：更新说明' }] } }
  const factories = []
  function render() {
    const winner = entries.get('conversation.chat.node').filter(entry => entry.options.key === 'assistant-step').sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0))[0]
    const props = { node, usePresentation: select => select({ foldCompletedTurns: false }), renderFactorySlot: (name, owner) => { factories.push({ name, owner }); return React.createElement('reasoning-body', owner) } }
    if (winner === native) props.renderSlot = (_name, owner) => DefaultReasoningBody({ ...owner, renderFactorySlot: props.renderFactorySlot })
    const all = []
    const resolve = value => {
      if (Array.isArray(value)) return value.forEach(resolve)
      if (!value || typeof value !== 'object') return
      if (typeof value.type === 'function') return resolve(value.type(value.props))
      all.push(value); resolve(value.props?.children)
    }
    resolve(React.createElement(winner.component, props))
    return { all, winner }
  }
  const notify = name => listeners.get(name)?.forEach(listener => listener())
  return { client, native, defaultBody, entries, factories, render, notify, bodySlot, dispose: () => disposers.forEach(dispose => dispose?.()) }
}

test('alpha native reasoning children keep public narration and complete reasoning through the official Factory', () => {
  const fixture = alphaReasoningFixture()
  const result = fixture.render()
  assert.notEqual(result.winner, fixture.native)
  assert.equal(result.winner.children, undefined)
  assert.equal(fixture.entries.get(fixture.bodySlot)[0], fixture.defaultBody)
  assert.equal(result.all.filter(element => element.props['data-pn-progress']).length, 1)
  assert.deepEqual(fixture.factories, [{ name: 'conversation.chat.reasoning.content', owner: { text: '完整原文思考', running: false } }])
  assert.equal(result.all.some(element => element.type === 'details'), false)
  fixture.dispose()
})

test('alpha disabled narration retains the complete native node and reasoning Factory', () => {
  const fixture = alphaReasoningFixture()
  fixture.client.updateSettings({ enabled: false })
  const result = fixture.render()
  assert.equal(result.all.some(element => element.props['data-pn-progress']), false)
  assert.equal(result.all.some(element => element.type === 'native' && element.props.children.flat().includes('正文\n\n📌 进度：更新说明')), true)
  assert.equal(fixture.factories[0].owner.text, '完整原文思考')
  fixture.dispose()
})

test('native reasoning adaptation depends on public registration ownership rather than function names', () => {
  const fixture = alphaReasoningFixture()
  Object.defineProperty(fixture.defaultBody.component, 'name', { value: 'minifiedBody' })
  fixture.notify(fixture.bodySlot)
  assert.notEqual(fixture.render().winner, fixture.native)
  fixture.dispose()
})

test('a third-party reasoning Body takes back native ownership without replacing its content', () => {
  const fixture = alphaReasoningFixture()
  assert.notEqual(fixture.render().winner, fixture.native)
  const custom = { component: function CustomReasoning() {}, options: { priority: 50 }, registrant: 'custom-reasoning' }
  fixture.entries.get(fixture.bodySlot).unshift(custom)
  fixture.notify(fixture.bodySlot)
  assert.equal(fixture.render().winner, fixture.native)
  assert.equal(fixture.entries.get(fixture.bodySlot)[0], custom)
  fixture.entries.get(fixture.bodySlot).shift()
  fixture.notify(fixture.bodySlot)
  assert.notEqual(fixture.render().winner, fixture.native)
  fixture.dispose()
})
