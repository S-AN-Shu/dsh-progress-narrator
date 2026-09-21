import { installToolFolding } from './tool-fold.js'
import { foldingPlan, readerOwnsFolding } from './folding.js'
import { createSettingsUI } from './settings-ui.js'
/** Client source; scripts/build-client.mjs embeds the shared protocol verbatim. */
export function createClient(React, protocol, runtime = window) {
  const h = React.createElement, API = '/api/progress-narrator/state'
  let toolRendererAvailable = () => true
  const EMPTY_CHAT = { order: [], nodes: new Map() }
  // better-display owns the Reader's process rows and their fold choreography.
  // The narrator still supplies the shared protocol, but it must not mount a
  // second <details> tree or DOM tool-fold controller over that Reader.  The
  // root marker is present as soon as Reader mounts; the row markers cover the
  // short hand-off during a root replacement and make the check useful in
  // isolated hosts as well.
  const readerOwnsFoldingNow = () => readerOwnsFolding(runtime.document)
  const LABELS = { 'waiting-model': '等待模型响应', 'receiving-model': '正在接收模型输出', 'waiting-tool': '等待工具返回', 'waiting-approval': '等待你审批或处理', retry: '等待模型重试', unknown: '运行状态暂无法确认' }
  let settings = { enabled: true, progressFontSize: 14, autoFoldHistory: true }, listeners = new Set()
  const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
  const readSettings = () => settings
  function updateSettings(cfg) {
    if (!cfg) return
    const next = { enabled: cfg.enabled, progressFontSize: cfg.progressFontSize ?? 14, autoFoldHistory: cfg.autoFoldHistory !== false }
    if (JSON.stringify(next) === JSON.stringify(settings)) return
    settings = next
    runtime.document?.documentElement.style.setProperty('--dsh-progress-font-size', (next.progressFontSize / 16) + 'rem')
    runtime.document?.documentElement.setAttribute('data-dsh-progress-enabled', String(cfg.enabled))
    listeners.forEach(fn => fn())
  }
  const duration = ms => { const sec = Math.floor(Math.max(0, ms) / 1000); return sec < 60 ? `${sec} 秒` : `${Math.floor(sec / 60)} 分 ${sec % 60} 秒` }
  function narrations(chat, turn) {
    const result = []
    for (const key of chat.order) {
      const node = chat.nodes.get(key)
      if (node?.visibility === 'hidden' || node?.kind !== 'assistant-step' || (turn != null && node.data.turn !== turn)) continue
      for (const part of protocol.progressSegments(node.data.blocks)) if (part.kind === 'progress') result.push({ key: `${key}:${part.start}:${part.offset}`, text: part.progressText, turn: node.data.turn, time: node.data.time, anchorSeq: node.anchorSeq, step: node.data.step, interrupted: node.data.status === 'interrupted' })
    }
    return result
  }
  function ProgressList({ items }) {
    const cfg = React.useSyncExternalStore(subscribe, readSettings, readSettings)
    if (!cfg.enabled || !items.length) return null
    return h('div', { 'data-pn': 'progress-list' }, items.map(n => h('div', { key: n.key, className: 'dsh-pn-progress', 'data-pn-progress': n.key },
      h('div', null, n.text), n.interrupted ? h('small', null, '已停止 · 保留已生成内容') : null)))
  }
  function useStateFeed(sid) {
    const [value, setValue] = React.useState(null)
    React.useEffect(() => {
      if (!sid) return
      let alive = true, timer, controller
      setValue(null)
      const poll = async () => {
        controller = new AbortController()
        const timeout = runtime.setTimeout(() => controller.abort(), 10000)
        try {
          const res = await runtime.fetch(API + '?session=' + encodeURIComponent(sid), { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
          if (!res.ok) throw new Error('state unavailable')
          const data = await res.json()
          if (!data.ok || data.sessionId !== sid) throw new Error('session mismatch')
          // Old Hosts advertise a 20px card default; keep them visually quiet too.
          if ((data.ruleVersion ?? 1) < 2 && data.config) data.config = { ...data.config, progressFontSize: 14 }
          if (alive) { updateSettings(data.config); setValue({ sid, data, receivedAt: runtime.performance.now(), failed: false }) }
        } catch {
          if (alive) setValue(previous => ({ ...previous, sid, failed: true }))
        } finally {
          runtime.clearTimeout(timeout)
          if (alive) timer = runtime.setTimeout(poll, 3000) // no overlapping requests
        }
      }
      poll()
      return () => { alive = false; controller?.abort(); runtime.clearTimeout(timer) }
    }, [sid])
    return value?.sid === sid ? value : null
  }
  function StatusDock(props) {
    const feed = useStateFeed(props.sessionId)
    // Keep configuration in sync without rendering a panel or running its clock.
    // A pre-upgrade Host omits the flag: that must also mean silent by default.
    return h(React.Fragment, null, h(ToolFoldController, props), feed?.data?.config?.enabled && feed.data.config.showStatusPanel === true ? h(StatusPanel, { ...props, feed }) : null)
  }
  function StatusPanel({ feed, ...props }) {
    const sid = props.sessionId
    const chat = props.useChat ? props.useChat(s => s) : EMPTY_CHAT
    const sessionRunning = props.useSession ? props.useSession(s => s.running) : undefined
    const [clock, setClock] = React.useState(() => runtime.performance.now())
    const liveExplanation = React.useRef({ session: null, turn: null, key: null, at: 0 })
    const cfg = feed?.data?.config ?? settings
    React.useEffect(() => {
      const timer = runtime.setInterval(() => setClock(runtime.performance.now()), cfg.uiTickMs ?? 1000)
      return () => runtime.clearInterval(timer)
    }, [cfg.uiTickMs])
    if (!cfg.enabled || !feed) return null
    const s = feed.data?.session
    const stale = feed.failed || (feed.receivedAt != null && clock - feed.receivedAt > 15000)
    if (!s) return stale || sessionRunning ? h('div', { className: 'dsh-pn-status', role: 'status' }, stale ? '插件状态 · 连接中断，运行状态暂无法确认。' : '插件状态 · 尚未观察到本轮执行记录，运行状态暂无法确认。') : null
    if (sessionRunning === false || !s.turnActive) return null
    const serverNow = feed.data.serverTime + Math.max(0, clock - feed.receivedAt)
    const latest = narrations(chat, s.turn).at(-1)
    // Text may still be streaming: its presence suppresses a false "no explanation"
    // notice, while authoritative phase/activity still comes from the Host.
    const observed = liveExplanation.current
    if (observed.session !== sid || observed.turn !== s.turn) liveExplanation.current = { session: sid, turn: s.turn, key: latest?.key ?? null, at: latest?.time ?? 0 }
    else if (latest && observed.key !== latest.key) liveExplanation.current = { session: sid, turn: s.turn, key: latest.key, at: serverNow }
    const explanationAt = Math.max(s.narrationAnchorAt ?? serverNow, liveExplanation.current.at)
    const waiting = serverNow - explanationAt >= cfg.waitingNoticeAfterMs
    const noActivity = s.lastActivityAt != null && serverNow - s.lastActivityAt >= cfg.noActivityNoticeAfterMs
    const approval = s.phase === 'waiting-approval'
    if (!waiting && !stale && !approval) return null
    const label = stale ? '连接中断，运行状态暂无法确认' : noActivity && !approval ? '长时间未收到活动，运行状态暂无法确认' : LABELS[s.phase] ?? LABELS.unknown
    const tools = !stale && s.phase === 'waiting-tool' ? s.waitingFor?.names?.join('、') : ''
    return h('section', { className: 'dsh-pn-status', 'data-pn': 'status-strip' },
      h('div', { role: 'status', 'aria-live': 'polite' }, label + (tools ? '：' + tools : '')),
      h('small', null, '插件状态'),
      h('div', { 'data-pn-clock': true }, '当前状态已持续 ' + duration(serverNow - (s.phaseStartedAt ?? serverNow)) + (s.lastActivityAt != null ? ' · 最近活动 ' + duration(serverNow - s.lastActivityAt) + '前' : ' · 尚无新的执行活动记录')))
  }
  const { SettingsSection, SettingsAction } = createSettingsUI(React, runtime, updateSettings)
  const planCache = new WeakMap()
  const planFor = chat => { if (!planCache.has(chat)) planCache.set(chat, foldingPlan(chat)); return planCache.get(chat) }
  function ToolFoldController(props) {
    const cfg = React.useSyncExternalStore(subscribe, readSettings, readSettings)
    const chat = props.useChat ? props.useChat(s => s) : EMPTY_CHAT
    const anchor = React.useRef(null), controller = React.useRef(null), current = React.useRef(null)
    current.current = { cfg, chat }
    React.useEffect(() => {
      controller.current = installToolFolding(runtime.document, anchor.current, () => planFor(current.current.chat).tools,
        () => current.current.cfg.autoFoldHistory && toolRendererAvailable() && !readerOwnsFoldingNow())
      return () => { controller.current?.dispose(); controller.current = null }
    }, [props.sessionId])
    React.useEffect(() => { controller.current?.refresh() }, [chat, cfg])
    return h('span', { ref: anchor, hidden: true, 'data-pn-tool-controller': true })
  }
  function BasicFold({ folded, label, children }) {
    const [manual, setManual] = React.useState(null)
    const [selected, setSelected] = React.useState(false)
    const element = React.useRef(null)
    React.useEffect(() => {
      const check = () => {
        const selection = runtime.document.getSelection?.()
        setSelected(!!selection && !selection.isCollapsed && !!selection.anchorNode && !!element.current?.contains(selection.anchorNode))
      }
      check(); runtime.document.addEventListener?.('selectionchange', check)
      return () => runtime.document.removeEventListener?.('selectionchange', check)
    }, [])
    const open = !folded || selected || manual === true
    return h('details', { ref: element, className: 'dsh-pn-fold', 'data-pn-fold': label, open,
      onToggle: e => { if (e.currentTarget.open !== open) setManual(e.currentTarget.open) } },
      h('summary', { hidden: !folded }, label), children)
  }
  function AssistantContent({ Native, props, blocks }) {
    const cfg = React.useSyncExternalStore(subscribe, readSettings, readSettings)
    const chat = props.useChat ? props.useChat(s => s) : EMPTY_CHAT
    // Reader and this official chat slot can coexist during a view switch. If
    // Reader is present, let it be the sole owner of process folding.
    if (readerOwnsFoldingNow() || !cfg.autoFoldHistory || props.turnProcess?.foldable) return h(Native, { ...props, node: { ...props.node, data: { ...props.node.data, blocks } } })
    const folded = planFor(chat).reasoning.has(props.node.key)
    // Keep body/final answer intact. Only reasoning groups get a disclosure.
    const groups = []
    blocks.forEach((block, index) => {
      const reasoning = block.kind === 'reasoning', last = groups.at(-1)
      if (last?.reasoning === reasoning) last.blocks.push(block)
      else groups.push({ reasoning, at: index, blocks: [block] })
    })
    return h(React.Fragment, null, groups.map(group => {
      const content = h(Native, { ...props, node: { ...props.node, data: { ...props.node.data, blocks: group.blocks } } })
      return group.reasoning ? h(BasicFold, { key: group.at, folded, label: '此前思考' }, content) : h(React.Fragment, { key: group.at }, content)
    }))
  }
  function wrapAssistant(Native) {
    return function ProgressAssistant(props) {
      const cfg = React.useSyncExternalStore(subscribe, readSettings, readSettings)
      if (!cfg.enabled) return h(AssistantContent, { Native, props, blocks: props.node.data.blocks ?? [] })
      const node = props.node, data = node.data, parts = protocol.progressSegments(data.blocks ?? [])
      const items = parts.filter(p => p.kind === 'progress').map(p => ({ key: `${node.key ?? data.step}:${p.start}:${p.offset}`, text: p.progressText, interrupted: data.status === 'interrupted' }))
      const process = props.turnProcess, spec = process?.spec
      if (process?.foldable && !process.open && data.step === spec?.answerStep) {
        const turn = node.location?.kind === 'step' || node.location?.kind === 'turn' ? node.location.turn : null
        for (const step of [...(turn?.steps ?? [])].reverse()) {
          const prior = step.data.get('assistant-step'), seq = prior?.finalNode?.seq
          if (seq == null || seq < spec.processStartSeq || seq >= spec.answerAnchorSeq) continue
          const earlier = protocol.progressSegments(prior.blocks).filter(p => p.kind === 'progress').map(p => ({ key: `${data.turn}:${prior.step}:${p.start}:${p.offset}`, text: p.progressText, interrupted: prior.status === 'interrupted' }))
          items.unshift(...earlier)
        }
      }
      // The projection is immutable. Only this render receives text with the
      // separately displayed progress spans removed; tools and source metadata stay.
      if (!items.length) return h(AssistantContent, { Native, props, blocks: data.blocks ?? [] })
      const blocks = protocol.withoutProgress(data.blocks)
      return h(React.Fragment, null, h(ProgressList, { items }), h(AssistantContent, { Native, props, blocks }))
    }
  }
  function wrapContext(Native) {
    return function QuietContext(props) {
      const source = props.node?.data?.source
      if (source?.kind === 'progress-narrator' && (source.control === 'teach' || source.control === 'nudge')) return null
      return h(Native, props)
    }
  }
  const CSS = `.dsh-pn-status{box-sizing:border-box;width:100%;min-width:0;margin:6px 0;padding:10px 14px;border-left:3px solid var(--dsw-alias-state-business-primary,#537abf);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform);font-size:1rem;line-height:1.5;overflow-wrap:anywhere}.dsh-pn-status small,.dsh-pn-status [data-pn-clock],.dsh-pn-progress small{font-size:.75rem;font-weight:400;color:var(--dsw-alias-label-secondary)}.dsh-pn-progress{box-sizing:border-box;min-width:0;margin:6px 0;padding:0;border:0;background:none;font-size:var(--dsh-progress-font-size,.875rem);font-weight:400;line-height:1.7;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;white-space:pre-wrap}`
  const SETTINGS_CSS = `.dsh-pn-tool-toggle{background:none;border:0;padding:6px 0;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer}.dsh-pn-tool-toggle::before{content:'▸';display:inline-block;margin-right:6px}.dsh-pn-tool-toggle[aria-expanded=true]::before{content:'▾'}[data-pn-tool-collapsed]>:not(.dsh-pn-tool-toggle){display:none!important}.dsh-pn-fold{border:0;background:none}.dsh-pn-fold>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:13px;padding:6px 0}.dsh-pn-fold>summary[hidden]{display:none}.dsh-pn-settings{max-width:640px;font-size:14px;color:var(--dsw-alias-label-primary);line-height:1.6}.dsh-pn-settings h2{display:flex;align-items:center;gap:8px;font-size:18px;font-weight:500;margin:0 0 8px}.dsh-pn-settings p,.dsh-pn-setting-row small{color:var(--dsw-alias-label-secondary);font-size:13px}.dsh-pn-settings fieldset{border:0;padding:0;margin:0;min-width:0}.dsh-pn-setting-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(70px,210px);gap:8px 16px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#8883);align-items:center}.dsh-pn-setting-row small{grid-column:1/-1}.dsh-pn-setting-row input[type=checkbox]{justify-self:end;width:16px;height:16px;accent-color:var(--dsw-alias-state-business-primary)}.dsh-pn-setting-row input[type=number],.dsh-pn-setting-row select,.dsh-pn-setting-row textarea{box-sizing:border-box;min-width:0;width:100%;padding:6px 8px;background:var(--dsw-alias-bg-base,#222);color:inherit;border:1px solid var(--dsw-alias-border-l1,#8885);border-radius:4px;font:inherit}.dsh-pn-setting-row textarea{grid-column:1/-1;resize:vertical}.dsh-pn-settings button{font:inherit;padding:6px 12px;border:1px solid var(--dsw-alias-border-l1,#8885);border-radius:4px;color:inherit;background:transparent;cursor:pointer}.dsh-pn-settings button:disabled{opacity:.5;cursor:default}.dsh-pn-setting-actions{margin-top:16px}.dsh-pn-settings>form details>summary{cursor:pointer;margin:16px 0 0}.dsh-pn-settings-trigger{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:4px;border:0;border-radius:4px;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer}.dsh-pn-settings-trigger:hover{background:var(--dsw-alias-bg-module-platform)}.dsh-pn-settings-dialog{box-sizing:border-box;width:min(560px,calc(100vw - 32px));max-height:85vh;overflow:auto;padding:24px;border:1px solid var(--dsw-alias-border-l1,#8885);border-radius:8px;background:var(--dsw-alias-bg-base,#222);color:var(--dsw-alias-label-primary)}.dsh-pn-settings-dialog::backdrop{background:#0005}.dsh-pn-dialog-close{float:right;background:none;color:inherit;border:0;padding:4px 8px;cursor:pointer}@media(max-width:480px){.dsh-pn-setting-row{grid-template-columns:minmax(0,1fr) minmax(70px,150px);gap:8px}.dsh-pn-settings-dialog{padding:16px}}`
  return {
    name: 'progress-narrator-client', inject: ['slots'],
    apply(ctx) {
      toolRendererAvailable = () => {
        const entries = typeof ctx.slots.entries === 'function' ? ctx.slots.entries('conversation.chat.node') : (ctx.slots.entriesOfSlot?.('conversation.chat.node') ?? [])
        const matching = entries.filter(e => e.options.key === 'tool-call')
        const entry = matching[0]
        return matching.length === 1 && !!entry && (!entry.registrant || entry.registrant.includes('dsh-client-ui-tool'))
      }
      ctx.effect(() => { const style = runtime.document.createElement('style'); style.textContent = CSS + SETTINGS_CSS; runtime.document.head.appendChild(style); return () => style.remove() })
      ctx.slots.inject('conversation.input.dock', function* () {
        yield ctx.slots.register({ name: 'conversation.input.dock', id: 'progress-narrator-status', order: 30 }, StatusDock)
      })
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'progress-narrator', order: 41, label: () => '工作说明' }, SettingsSection))
      ctx.slots.inject('settings.action', () => ctx.slots.register({ name: 'settings.action', id: 'progress-narrator', order: 20 }, SettingsAction))
      for (const [key, wrap] of [['assistant-step', wrapAssistant], ['context', wrapContext]]) ctx.slots.inject('conversation.chat.node', () => {
        // Declaration readiness does not imply that its native entry exists yet.
        // Observe the raw ledger so our own shadow never hides its dependency.
        const slot = 'conversation.chat.node'
        let current, base, wrapped, dispose, stopped = false
        const reconcile = () => {
          if (stopped) return
          const hasAll = typeof ctx.slots.entries === 'function'
          const entries = hasAll ? ctx.slots.entries(slot) : (ctx.slots.entriesOfSlot?.(slot) ?? [])
          const candidates = entries.filter(e => e.options.key === key && e.component !== wrapped)
          const native = candidates.length === 1 ? candidates[0] : undefined
          if (!hasAll) {
            if (!base && native) base = native
            if (entries.some(e => e.options.key === key && e.component === wrapped)) return
            if (base && native && native.component !== base.component) { dispose?.(); dispose = undefined; current = native; return }
          }
          if (native === current) return
          dispose?.(); dispose = undefined; current = native
          if (!native || native.children) return
          wrapped = wrap(native.component)
          dispose = ctx.slots.register({ name: slot, key, priority: (native.options.priority ?? 0) - 1, ...(native.locale ? { locale: native.locale } : {}), ...(native.inject ? { inject: native.inject } : {}), ...(native.store ? { store: native.store } : {}) }, wrapped)
        }
        const unsubscribe = ctx.slots.subscribe(slot, reconcile)
        try { reconcile() } catch (error) { unsubscribe(); throw error }
        return () => { stopped = true; unsubscribe(); dispose?.() }
      })
      ctx.effect(() => () => { listeners.clear(); runtime.document.documentElement.style.removeProperty('--dsh-progress-font-size'); runtime.document.documentElement.removeAttribute('data-dsh-progress-enabled') })
    },
    // Pure/React surfaces used by isolated acceptance, not a second implementation.
    StatusDock, ProgressList, wrapAssistant, wrapContext, ToolFoldController, BasicFold, SettingsSection, SettingsAction, installToolFolding, narrations, updateSettings,
  }
}
