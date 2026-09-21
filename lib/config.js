import z from '@deepseek-ai/schemastery'

export const NUMBERS = {
  silentStepThreshold: [6, 1, 100, true], narrationIntervalMs: [120000, 1000, 3600000],
  minNudgeIntervalMs: [120000, 1000, 3600000], maxNudgesPerTurn: [0, 0, 100, true],
  waitingNoticeAfterMs: [45000, 1000, 3600000], noActivityNoticeAfterMs: [120000, 1000, 3600000],
  uiTickMs: [1000, 250, 60000], progressFontSize: [14, 12, 24],
}
export const BOOLEANS = { enabled: true, showStatusPanel: false, autoFoldHistory: true, backoffEnabled: true }
export const CHOICES = { triggerMode: ['either', 'time', 'steps', 'both'], narrationStyle: ['first-person', 'stages', 'cat', 'custom'] }
// One validator for composition, persisted settings and API writes. In particular,
// schemastery's UI hints are not used as a substitute for integer/unknown-key checks.
export function validateConfig(value, partial = false) {
  if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value))) return { issues: [{ message: 'config must be an object' }] }
  const input = value ?? {}, result = {}, issues = []
  const issue = (key, message) => issues.push({ path: [key], message })
  const keys = new Set([...Object.keys(NUMBERS), ...Object.keys(BOOLEANS), ...Object.keys(CHOICES), 'customStyle'])
  for (const key of Object.keys(input)) if (!keys.has(key)) issue(key, 'unknown configuration key')
  for (const [key, fallback] of Object.entries(BOOLEANS)) {
    if (partial && input[key] === undefined) continue
    const v = input[key] === undefined ? fallback : input[key]
    if (typeof v !== 'boolean') issue(key, `${key} must be boolean`)
    else result[key] = v
  }
  for (const [key, [fallback, min, max, integer]] of Object.entries(NUMBERS)) {
    if (partial && input[key] === undefined) continue
    const v = input[key] === undefined ? fallback : input[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) issue(key, `expected ${integer ? 'integer' : 'number'} in [${min}, ${max}]`)
    else result[key] = v
  }
  for (const [key, choices] of Object.entries(CHOICES)) {
    if (partial && input[key] === undefined) continue
    const v = input[key] === undefined ? choices[0] : input[key]
    if (!choices.includes(v)) issue(key, 'invalid option')
    else result[key] = v
  }
  if (!partial || input.customStyle !== undefined) {
    const v = input.customStyle === undefined ? '' : input.customStyle
    if (typeof v !== 'string' || v.length > 2000) issue('customStyle', 'customStyle must be a string of at most 2000 characters')
    else result.customStyle = v
  }
  return issues.length ? { issues } : { value: result }
}
export const Config = { '~standard': { version: 1, vendor: 'dsh-progress-narrator', validate: value => validateConfig(value) } }
export function assertConfig(value) {
  const result = validateConfig(value)
  if (result.issues) throw new TypeError(result.issues.map(i => `${i.path?.[0] ?? 'config'}: ${i.message}`).join('; '))
  return result.value
}
export const SettingsSchema = z.object({
  ...Object.fromEntries(Object.entries(BOOLEANS).map(([k, v]) => [k, z.boolean().default(v)])),
  ...Object.fromEntries(Object.entries(NUMBERS).map(([k, [v, min, max, integer]]) => [k, (integer ? z.number().min(min).max(max).step(1) : z.number().min(min).max(max)).default(v)])),
  ...Object.fromEntries(Object.entries(CHOICES).map(([k, values]) => [k, z.union(values.map(v => z.const(v))).default(values[0])])),
  customStyle: z.string().default(''),
})
