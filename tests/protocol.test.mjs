import test from 'node:test'
import assert from 'node:assert/strict'
import { PROTOCOL_VERSION, PROGRESS_MARKER, hasProgressLine, scanProgressSpans } from '../lib/protocol.js'

test('协议常量', () => {
  assert.equal(PROTOCOL_VERSION, 1)
  assert.equal(PROGRESS_MARKER, '📌')
})

test('规范格式:H2 标题独占一行', () => {
  const src = '一些正文。\n\n## 📌 进度：已定位配置加载问题，正在验证修改后的启动流程。\n\n继续正文。'
  const spans = scanProgressSpans(src)
  assert.equal(spans.length, 1)
  assert.equal(spans[0].kind, 'heading')
  assert.equal(spans[0].text, '已定位配置加载问题，正在验证修改后的启动流程。')
  assert.equal(src.slice(spans[0].start, spans[0].end), '## 📌 进度：已定位配置加载问题，正在验证修改后的启动流程。')
})

test('兼容格式:顶层段落 + 英文冒号', () => {
  const spans = scanProgressSpans('📌 进度: starting verification')
  assert.equal(spans.length, 1)
  assert.equal(spans[0].kind, 'paragraph')
  assert.equal(spans[0].text, 'starting verification')
})

test('兼容格式:成对加粗包裹(交接文档示例形态)', () => {
  const spans = scanProgressSpans('**📌 进度：已定位配置加载问题，正在验证修改后的启动流程。**')
  assert.equal(spans.length, 1)
  assert.equal(spans[0].text, '已定位配置加载问题，正在验证修改后的启动流程。')
})

test('兼容格式:H3 漂移仍按标题识别', () => {
  const spans = scanProgressSpans('### 📌 进度：进入验证阶段')
  assert.equal(spans.length, 1)
  assert.equal(spans[0].kind, 'heading')
})

test('CRLF 换行正常识别且偏移不串行', () => {
  const src = '## 📌 进度：第一句\r\n普通行\r\n📌 进度：第二句\r\n'
  const spans = scanProgressSpans(src)
  assert.equal(spans.length, 2)
  assert.equal(src.slice(spans[0].start, spans[0].end), '## 📌 进度：第一句')
  assert.equal(src.slice(spans[1].start, spans[1].end), '📌 进度：第二句')
})

test('代码围栏内的同样文字不识别', () => {
  const src = ['前文', '```bash', '## 📌 进度：围栏里的假播报', '```', '尾文'].join('\n')
  assert.equal(scanProgressSpans(src).length, 0)
})

test('波浪线围栏同样排除', () => {
  const src = ['~~~', '📌 进度：围栏里的假播报', '~~~'].join('\n')
  assert.equal(scanProgressSpans(src).length, 0)
})

test('围栏外的真播报与围栏内的假播报共存时只识别前者', () => {
  const src = ['## 📌 进度：真播报', '', '```', '📌 进度：假播报', '```'].join('\n')
  const spans = scanProgressSpans(src)
  assert.equal(spans.length, 1)
  assert.equal(spans[0].text, '真播报')
})

test('引用块 / 列表项 / 4 空格缩进 / 转义标题都不识别', () => {
  assert.equal(scanProgressSpans('> 📌 进度：引用里的').length, 0)
  assert.equal(scanProgressSpans('- 📌 进度：列表里的').length, 0)
  assert.equal(scanProgressSpans('1. 📌 进度：列表里的').length, 0)
  assert.equal(scanProgressSpans('    ## 📌 进度：缩进代码').length, 0)
  assert.equal(scanProgressSpans('\\## 📌 进度：转义标题').length, 0)
})

test('不把任意 📌 开头文本认作进度', () => {
  assert.equal(scanProgressSpans('📌 待办：稍后回来处理').length, 0)
  assert.equal(scanProgressSpans('📌 进度 没有冒号').length, 0)
  assert.equal(scanProgressSpans('今天 📌 进度：不在行首的').length, 0)
})

test('同一块中普通文字、进度行、普通文字按源顺序分开', () => {
  const src = ['开工前的一段话。', '## 📌 进度：开始准备 xxx 的设计。', '紧跟着的普通说明。'].join('\n')
  const spans = scanProgressSpans(src)
  assert.equal(spans.length, 1)
  assert.equal(spans[0].start, src.indexOf('## 📌'))
  assert.ok(spans[0].start > src.indexOf('开工前'))
  assert.ok(spans[0].end < src.indexOf('紧跟着'))
})

test('多个播报行按源顺序返回', () => {
  const src = '## 📌 进度：A\n中间文字\n## 📌 进度：B'
  const spans = scanProgressSpans(src)
  assert.deepEqual(spans.map((s) => s.text), ['A', 'B'])
  assert.ok(spans[0].start < spans[1].start)
})

test('末尾无换行的最后一行仍识别', () => {
  const spans = scanProgressSpans('正文\n## 📌 进度：收尾')
  assert.equal(spans.length, 1)
  assert.equal(spans[0].text, '收尾')
})

test('空输入与非法输入', () => {
  assert.deepEqual(scanProgressSpans(''), [])
  assert.deepEqual(scanProgressSpans(undefined), [])
  assert.deepEqual(scanProgressSpans(null), [])
  assert.deepEqual(scanProgressSpans(42), [])
})

test('hasProgressLine 快捷判断', () => {
  assert.equal(hasProgressLine('## 📌 进度：x'), true)
  assert.equal(hasProgressLine('普通文本'), false)
})
