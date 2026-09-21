/** Native ToolCallTree owns child slots, so leave its renderer and DOM subtree intact.
 * This controller adds only a sibling disclosure button to the documented Chat row.
 * It never moves/removes React-owned nodes or operates Reader's different row hooks.
 */
export function installToolFolding(document, host, getFoldedKeys, enabled) {
  const tracked = new Map(), manual = new Set()
  let stopped = false, scheduled = false
  const restore = row => {
    const state = tracked.get(row)
    state?.button.remove(); row.removeAttribute('data-pn-tool-collapsed'); tracked.delete(row)
  }
  const reconcile = () => {
    scheduled = false
    if (stopped) return
    const scope = host.closest('[data-conversation-scroll]') ?? document
    const keys = getFoldedKeys()
    const active = enabled()
    for (const [row] of tracked) {
      if (!active || !row.isConnected || !keys.has(row.dataset.chatFlowKey) || row.hasAttribute('data-turn-process-member')) restore(row)
    }
    if (!active) return
    for (const row of scope.querySelectorAll('[data-chat-flow-kind="tool-call"]')) {
      const key = row.dataset.chatFlowKey
      if (!keys.has(key) || row.hasAttribute('data-turn-process-member')) continue
      let state = tracked.get(row)
      if (!state) {
        const button = document.createElement('button')
        button.type = 'button'; button.className = 'dsh-pn-tool-toggle'
        button.dataset.pnToolToggle = key
        button.addEventListener('click', event => {
          event.stopPropagation()
          if (manual.has(key)) manual.delete(key); else manual.add(key)
          reconcile()
        })
        state = { button }; tracked.set(row, state)
        row.prepend(button)
      }
      const selection = document.getSelection()
      const selected = selection && !selection.isCollapsed && row.contains(selection.anchorNode)
      const collapsed = !manual.has(key) && !selected
      if (row.hasAttribute('data-pn-tool-collapsed') !== collapsed) row.toggleAttribute('data-pn-tool-collapsed', collapsed)
      const expanded = String(!collapsed), label = collapsed ? '此前工具输出' : '收起工具输出'
      if (state.button.getAttribute('aria-expanded') !== expanded) state.button.setAttribute('aria-expanded', expanded)
      if (state.button.textContent !== label) state.button.textContent = label
    }
  }
  const schedule = () => { if (!scheduled && !stopped) { scheduled = true; queueMicrotask(reconcile) } }
  const observer = new document.defaultView.MutationObserver(schedule)
  observer.observe(host.closest('[data-conversation-scroll]') ?? document.body, { childList: true, subtree: true })
  document.addEventListener('selectionchange', schedule)
  reconcile()
  return { refresh: schedule, dispose() { stopped = true; observer.disconnect(); document.removeEventListener('selectionchange', schedule); for (const [row] of tracked) restore(row) } }
}
