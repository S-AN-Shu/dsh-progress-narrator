/** Canonical progress-line parser. Offsets refer to the unchanged source string. */
export const PROGRESS_MARKER = '📌'
export const PROTOCOL_VERSION = 1
export function scanProgressSpans(text) {
  if (typeof text !== 'string' || !text) return []
  const spans = []
  let fence = null, list = false, quote = false, html = null, start = 0
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const end = start + line.length
    if (html) {
      if (html.until ? html.until.test(line) : !line.trim()) html = null
    } else if (fence) {
      if (new RegExp('^ {0,3}' + fence.char + '{' + fence.length + ',}[ \\t]*$').test(line)) fence = null
    } else {
      const opener = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
      if (!line.trim()) { list = false; quote = false }
      else if (opener && !(opener[1][0] === '`' && opener[2].includes('`'))) fence = { char: opener[1][0], length: opener[1].length }
      else if (/^ {0,3}>/.test(line)) quote = true
      else if (/^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+/.test(line)) list = true
      else if (/^ {0,3}<!--/.test(line)) html = /-->/.test(line) ? null : { until: /-->/ }
      else if (/^ {0,3}<(script|style|pre|textarea)(?:\s|>|$)/i.test(line)) html = /<\/(?:script|style|pre|textarea)>/i.test(line) ? null : { until: /<\/(?:script|style|pre|textarea)>/i }
      else if (/^ {0,3}<!\[CDATA\[/.test(line)) html = /\]\]>/.test(line) ? null : { until: /\]\]>/ }
      else if (/^ {0,3}<\?/.test(line)) html = /\?>/.test(line) ? null : { until: /\?>/ }
      else if (/^ {0,3}<![A-Z]/.test(line)) html = />/.test(line) ? null : { until: />/ }
      else if (/^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?\s*>|$)/i.test(line)) html = { until: null }
      else if (!html && !/^[ \t\\]/.test(line)) {
        const heading = /^(#{1,6})[ \t]+(.*)$/.exec(line)
        // A top-level ATX heading interrupts lazy quote/list continuation.
        if (heading) { list = false; quote = false }
        if (!list && !quote) {
          let body = heading ? heading[2].replace(/[ \t]+#+[ \t]*$/, '') : line
          if (body.startsWith('**') && body.endsWith('**') && body.length >= 4) body = body.slice(2, -2)
          const match = /^📌[ \t]*进度[ \t]*[:：][ \t]*(.+?)\s*$/.exec(body)
          if (match && match[1].trim()) spans.push({ kind: heading ? 'heading' : 'paragraph', start, end, text: match[1].trim() })
        }
      }
    }
    start += raw.length + 1
  }
  return spans
}
export function hasProgressLine(text) { return scanProgressSpans(text).length > 0 }
/** Shared Reader/Host/client source segmentation. Adjacent text blocks share context. */
export function progressSegments(blocks) {
  const result = []
  let previous
  const append = part => {
    if (part.kind !== 'progress' && previous?.kind === part.kind) previous.blocks.push(...part.blocks)
    else { result.push(part); previous = part }
  }
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]
    if (block.kind === 'tool-call') { previous = undefined; continue }
    if (block.kind !== 'text') {
      append({ kind: block.kind === 'reasoning' ? 'reasoning' : 'body', start: index, offset: 0, blocks: [block] })
      continue
    }
    const first = index, run = [block]
    while (blocks[index + 1]?.kind === 'text') run.push(blocks[++index])
    const text = run.map(b => b.text ?? '').join(''), spans = scanProgressSpans(text)
    if (!spans.length) { append({ kind: 'body', start: first, offset: 0, blocks: run }); continue }
    const slice = (start, end) => {
      let at = 0
      return run.flatMap(b => {
        const begin = at; at += b.text.length
        if (at <= start || begin >= end) return []
        return [{ ...b, text: b.text.slice(Math.max(0, start - begin), Math.min(b.text.length, end - begin)) }]
      })
    }
    let cursor = 0
    for (const span of spans) {
      if (span.start > cursor) append({ kind: 'body', start: first, offset: cursor, blocks: slice(cursor, span.start) })
      append({ kind: 'progress', start: first, offset: span.start, progressText: span.text, blocks: slice(span.start, span.end) })
      cursor = span.end
    }
    if (cursor < text.length) append({ kind: 'body', start: first, offset: cursor, blocks: slice(cursor, text.length) })
  }
  return result
}

/** Remove only recognized progress spans, preserving every original non-text block. */
export function withoutProgress(blocks) {
  const output = []
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind !== 'text') { output.push(blocks[i]); continue }
    const run = [blocks[i]]
    while (blocks[i + 1]?.kind === 'text') run.push(blocks[++i])
    const spans = scanProgressSpans(run.map(b => b.text).join(''))
    let offset = 0
    for (const block of run) {
      const end = offset + block.text.length
      let cursor = offset, text = ''
      for (const span of spans) {
        if (span.end <= offset || span.start >= end) continue
        text += block.text.slice(cursor - offset, Math.max(offset, span.start) - offset)
        cursor = Math.min(end, span.end)
      }
      text += block.text.slice(cursor - offset)
      output.push(text === block.text ? block : { ...block, text })
      offset = end
    }
  }
  return output
}
