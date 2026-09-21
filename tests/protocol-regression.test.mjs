import test from 'node:test'
import assert from 'node:assert/strict'
import { scanProgressSpans, withoutProgress } from '../lib/protocol.js'
test('HTML comments and raw blocks stay excluded across blank lines', () => {
  for (const [open, close] of [['<!--', '-->'], ['<script>', '</script>'], ['<![CDATA[', ']]>']]) {
    const source = `${open}\n\n## 📌 进度：示例\n${close}\n\n## 📌 进度：真实`
    assert.deepEqual(scanProgressSpans(source).map(s => s.text), ['真实'])
  }
})
test('empty markers and lazy list/quote text are not progress', () => {
  for (const source of ['## 📌 进度：', '> 引用\n📌 进度：假', '- 示例\n📌 进度：假', '<section>\n## 📌 进度：假\n</section>']) assert.equal(scanProgressSpans(source).length, 0)
})
test('native display filtering preserves tools, metadata, and raw source', () => {
  const tool = { kind: 'tool-call', callId: 'a' }
  const source = [{ kind: 'text', text: '正文\n## 📌 进度：已读取\n结尾', identity: 'kept' }, tool]
  const output = withoutProgress(source)
  assert.equal(output[1], tool)
  assert.equal(output[0].identity, 'kept')
  assert.equal(output[0].text, '正文\n\n结尾')
  assert.match(source[0].text, /已读取/)
})
