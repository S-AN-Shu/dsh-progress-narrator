export function createSettingsUI(React, runtime, updateSettings) {
  const h = React.createElement, endpoint = '/api/progress-narrator/settings'
  function BubbleIcon() {
    return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
      h('path', { d: 'M20 11.5c0 4.1-3.6 7.5-8 7.5-1.1 0-2.1-.2-3-.5L4 20l1.4-4.1A7 7 0 0 1 4 11.5C4 7.4 7.6 4 12 4s8 3.4 8 7.5Z', strokeLinejoin: 'round' }),
      ...[8, 12, 16].map(cx => h('circle', { key: cx, cx, cy: 11.5, r: .8, fill: 'currentColor', stroke: 'none' })))
  }
  function SettingsSection() {
    const [data, setData] = React.useState(null), [draft, setDraft] = React.useState(null)
    const [status, setStatus] = React.useState(''), [busy, setBusy] = React.useState(false), [reload, setReload] = React.useState(0)
    React.useEffect(() => {
      const controller = new AbortController()
      setStatus('正在读取设置…')
      runtime.fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async res => {
        if (!res.ok) throw new Error(res.status === 404 ? '新版后台尚未加载。当前任务结束后，下次正常启动 DSH 即可启用这些设置。' : '暂时无法读取设置。')
        const value = await res.json()
        if (controller.signal.aborted) return
        setData(value); setDraft(value.config); updateSettings(value.config)
        setStatus(value.writable ? '' : '当前后台不支持保存设置。')
      }).catch(e => { if (!controller.signal.aborted) setStatus(e.message) })
      return () => controller.abort()
    }, [reload])
    const change = (key, value) => setDraft(current => ({ ...current, [key]: value }))
    const save = async event => {
      event.preventDefault(); setBusy(true); setStatus('正在保存…')
      try {
        const patch = Object.fromEntries(Object.keys(draft).filter(k => draft[k] !== data.config[k]).map(k => [k, draft[k]]))
        const res = await runtime.fetch(endpoint, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patch, expectedRevision: data.revision }) })
        if (!res.ok) throw new Error(res.status === 409 ? '设置已在其他页面更新，请重新读取后再保存。' : '保存失败，请检查数值范围或稍后重试。')
        const value = await res.json(); setData(value); setDraft(value.config); updateSettings(value.config)
        setStatus('已保存。频率和风格从后续正常请求边界生效。')
      } catch (e) { setStatus(e.message) } finally { setBusy(false) }
    }
    const row = (label, input, help) => h('label', { className: 'dsh-pn-setting-row' }, h('span', null, label), input, help && h('small', null, help))
    const toggle = (key, label, help) => row(label, h('input', { 'aria-label': label, type: 'checkbox', checked: draft[key], onChange: e => change(key, e.target.checked) }), help)
    const number = (key, label, min, max, unit = 1, help) => row(label, h('input', { 'aria-label': label, type: 'number', min, max, step: 1, required: true, value: draft[key] / unit, onChange: e => change(key, e.target.value === '' ? '' : Number(e.target.value) * unit) }), help)
    const select = (key, label, values) => row(label, h('select', { 'aria-label': label, value: draft[key], onChange: e => change(key, e.target.value) }, values.map(([value, text]) => h('option', { key: value, value }, text))))
    return h('section', { className: 'dsh-pn-settings', 'aria-label': '工作说明设置' },
      h('h2', null, h(BubbleIcon), '工作说明'),
      h('p', null, '简短说明正在做什么，保留最新思考和工具。'),
      draft && h('form', { onSubmit: save }, h('fieldset', { disabled: busy || !data.writable },
        toggle('enabled', '启用工作说明'),
        select('narrationStyle', '播报风格', [['first-person', '常规第一人称'], ['stages', '阶段进展报告'], ['cat', '猫娘模式'], ['custom', '自定义']]),
        draft.narrationStyle === 'custom' && row('自定义风格', h('textarea', { 'aria-label': '自定义风格', rows: 3, maxLength: 2000, value: draft.customStyle, onChange: e => change('customStyle', e.target.value), placeholder: '例如：语气平实，先说已确认的结果，再说下一步。' })),
        number('narrationIntervalMs', '无说明时长（秒）', 1, 3600, 1000),
        toggle('firstNarration', '首次工作先说明', '第一次实际工作前先说一句准备做什么；模型没有先说明时，下一步只提醒一次。'),
        number('silentStepThreshold', '无说明模型步数', 1, 100),
        select('triggerMode', '提醒触发方式', [['either', '时长或步数达到任一项'], ['both', '时长和步数都达到'], ['time', '仅按时长'], ['steps', '仅按步数']]),
        number('minNudgeIntervalMs', '最短提醒间隔（秒）', 1, 3600, 1000, '首次提醒、两次提醒之间、已有工作说明之后，都遵守这个间隔。推荐 120 秒。'),
        toggle('autoFoldHistory', '自动折叠历史思考和工具', '仅控制官方对话视图的显示。阅读视图及其他接管折叠的插件使用自己的设置；不压缩模型上下文。'),
        h('details', null, h('summary', null, '更多设置'),
          toggle('backoffEnabled', '未回应提醒时自动放慢', '连续未回应后逐步放慢，最多为最短间隔的两倍；有工作说明后恢复。'),
          number('maxNudgesPerTurn', '每轮提醒上限', 0, 100, 1, '0 表示持续提醒，仍遵守间隔与退避。设为 2 等有限值会在用尽后停止提醒。'),
          number('progressFontSize', '工作说明字号', 12, 24),
          toggle('showStatusPanel', '显示等待状态面板', '默认关闭，保持对话安静。')),
        h('div', { className: 'dsh-pn-setting-actions' }, h('button', { type: 'submit' }, busy ? '保存中…' : '保存设置')))),
      h('p', { role: 'status', 'aria-live': 'polite' }, status),
      h('button', { type: 'button', disabled: busy, onClick: () => setReload(n => n + 1) }, '重新读取'))
  }
  function SettingsAction() {
    const dialog = React.useRef(null), [open, setOpen] = React.useState(false)
    React.useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close() }, [open])
    return h(React.Fragment, null,
      h('button', { type: 'button', className: 'dsh-pn-settings-trigger', title: '工作说明设置', 'aria-label': '工作说明设置', onClick: () => setOpen(true) }, h(BubbleIcon)),
      h('dialog', { ref: dialog, className: 'dsh-pn-settings-dialog', 'aria-label': '工作说明设置', onCancel: () => setOpen(false), onClose: () => setOpen(false) },
        open && h(React.Fragment, null, h('button', { type: 'button', className: 'dsh-pn-dialog-close', onClick: () => setOpen(false) }, '关闭'), h(SettingsSection))))
  }
  return { SettingsSection, SettingsAction, BubbleIcon }
}
