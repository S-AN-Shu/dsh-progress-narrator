import test from 'node:test'
import assert from 'node:assert/strict'
import * as protocol from '../lib/protocol.js'
import { createNarrationEngine } from '../lib/state.js'
import { createClient } from '../src/client.js'

test('a departing sibling Reader does not suppress native public output', () => {
  const React = {createElement:(type,props,...children)=>({type,props,children}),
    useSyncExternalStore:(_subscribe,read)=>read(),useRef:()=>({current:null}),
    useState:initial=>[initial,()=>{}],useLayoutEffect:()=>{}}
  const client=createClient(React,protocol,{document:{querySelector:()=>({reader:true})}})
  const render=client.wrapAssistant(function Native(){})
  const result=render({node:{key:'native',data:{step:1,blocks:[{kind:'text',text:'正文\n\n📌 进度：说明'}]}}})
  assert.equal(result.props['data-pn-source-row'],'native')
  assert.equal(result.children[0].length,2)
  assert.equal(result.children[0][1].children[0],'说明')
})

test('public projection preserves order, offsets, media and unknown blocks without empty seats', () => {
  const blocks = [{kind:'reasoning',text:'思考'}, {kind:'text',text:'先读文件。\n\n📌 进度：输入已经确认。接着检查更新。\n\n'}, {kind:'text',text:'继续检查。'}, {kind:'image',attachment:{}}, {kind:'future',value:1}]
  const before = JSON.stringify(blocks)
  const parts = protocol.publicTextSegments(blocks)
  assert.deepEqual(parts.map(p => p.kind), ['reasoning','body','progress','body','other','other'])
  assert.deepEqual(parts.filter(p => p.public).map(p => p.progressText ?? p.blocks.map(b => b.text).join('').trim()), ['先读文件。','输入已经确认。接着检查更新。','继续检查。'])
  assert.equal(JSON.stringify(blocks), before)
  assert.equal(protocol.publicTextSegments([{kind:'text',text:' \n\t'}]).length, 0)
})

test('source identity survives prefix classification and text growth', () => {
  const project = text => protocol.publicTextSegments([{kind:'text',text}])[0]
  for (const text of ['📌 进度：确认。','📌 进度：确认。接着检查。']) {
    const part = project(text)
    assert.equal(part.start, 0); assert.equal(part.offset, 0)
  }
  assert.equal(project('📌 进度：').renderable, false)
  assert.equal(project('```\n📌 进度：示例\n```').kind, 'body')
  assert.equal(project('> 📌 进度：引用').kind, 'body')
})

test('plain public text cancels first nudge with a bounded grace, explicit narration resets cadence', () => {
  let clock = 0, seq = 0
  const engine = createNarrationEngine({now:()=>clock,config:{firstNarration:true,silentStepThreshold:1,minNudgeIntervalMs:10000}})
  const event = (type,data) => engine.observeEvent('s',{seq:seq++,time:clock,type,data})
  const next = () => engine.beginPreStep('s',{turn:1,rulesPresent:true})
  event('turn/start',{turn:1})
  event('assistant/message',{turn:1,step:0,message:{content:[{type:'text',text:'我先检查输入。'}]}})
  assert.equal(next().nudge,false)
  assert.equal(engine.snapshot('s').decisionReason,'public-text-grace')
  clock=9999; assert.equal(next().nudge,false)
  clock=10000; assert.equal(next().nudge,true)
  event('assistant/message',{turn:1,step:1,message:{content:[{type:'text',text:'📌 进度：输入确认。接着检查更新。'}]}})
  assert.equal(engine.snapshot('s').silentSteps,0)
  assert.equal(next().nudge,false)
})
