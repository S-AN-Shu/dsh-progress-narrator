/** Read-only display policy. Source order and message data are never rewritten. */
export function foldingPlan(chat) {
  const latestReasoning = new Map(), latestTool = new Map(), nodes = []
  for (const key of chat?.order ?? []) {
    const node = chat.nodes.get(key)
    if (!node || node.visibility === 'hidden') continue
    const turn = node.data?.turn ?? node.location?.turn?.turn
    nodes.push({ key, node, turn })
    if (node.kind === 'assistant-step' && node.data.blocks?.some(b => b.kind === 'reasoning' && b.text?.trim())) latestReasoning.set(turn, key)
    if (node.kind === 'tool-call') {
      const root = node.data.root
      const step = root?.step ?? node.location?.step?.step
      latestTool.set(turn, step ?? key)
    }
  }
  const reasoning = new Set(), tools = new Set()
  const running = root => root && (root.kind !== 'tool-result' || (root.subCalls ?? []).some(running))
  for (const { key, node, turn } of nodes) {
    if (node.kind === 'assistant-step' && key !== latestReasoning.get(turn) && node.data.status !== 'running' && node.data.status !== 'interrupted') reasoning.add(key)
    if (node.kind === 'tool-call') {
      const root = node.data.root, step = root?.step ?? node.location?.step?.step ?? key
      if (root && !running(root) && !root.isError && step !== latestTool.get(turn)) tools.add(key)
    }
  }
  return { reasoning, tools }
}

/** Return true when the richer Reader has mounted and owns process folding. */
export function readerOwnsFolding(document) {
  return Boolean(document?.querySelector?.('[data-dsh-better-display], [data-reader-flow], [data-reader-turn]'))
}
