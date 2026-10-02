/** Only rows registered by our renderer are exempt. Restore the host's CURRENT
 * policy on disposal (not a stale hidden-attribute snapshot from registration). */
export function retainPublicRow(anchor, nodeKey, document) {
  const row = anchor?.closest('[data-chat-node-key]')
  if (!row || row.getAttribute('data-chat-node-key') !== nodeKey || row.getAttribute('data-chat-group-part') === 'reasoning') return () => {}
  const restore = () => {
    if (row.getAttribute('data-turn-process-hidden') === 'true') row.setAttribute('hidden', 'until-found')
    else row.removeAttribute('hidden')
  }
  const reveal = () => {
    if (row.getAttribute('data-turn-process-member') === 'true' && row.getAttribute('data-turn-process-hidden') === 'true' && row.hasAttribute('hidden')) row.removeAttribute('hidden')
  }
  const observer = new document.defaultView.MutationObserver(reveal)
  observer.observe(row, {attributes:true,attributeFilter:['hidden','data-turn-process-hidden','data-turn-process-member']})
  reveal()
  return () => { observer.disconnect(); restore() }
}
