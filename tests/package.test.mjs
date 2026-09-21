import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const patchRel = (pkg.dsh?.bundle?.patch ?? '').replace(/^\.\//, '')
test('manifest declares dsh.bundle.patch and ships the referenced file', () => {
  assert.equal(typeof pkg.dsh?.bundle?.patch, 'string')
  assert.notEqual(patchRel, '')
  assert.ok(existsSync(join(root, patchRel)), patchRel + ' must exist in the repository')
  assert.ok((pkg.files ?? []).includes(patchRel), patchRel + ' must be listed in "files"')
})
test('bundle patch inserts exactly one loader entry named after the package', () => {
  const text = readFileSync(join(root, patchRel), 'utf8')
  assert.equal((text.match(/- insert:/g) ?? []).length, 1)
  assert.match(text, /id:\s*progress-narrator/)
  assert.ok(text.includes(pkg.name), 'entry name must equal the package name')
})
test('host plugin id and version track the manifest', async () => {
  const host = await import('../lib/index.js')
  assert.equal(host.name, pkg.name)
  assert.equal(host.VERSION, pkg.version)
})
test('manifest is publishable and advertises the discovery topic', () => {
  assert.notEqual(pkg.private, true)
  assert.ok((pkg.keywords ?? []).includes('dsh-plugin'))
  assert.ok(existsSync(join(root, 'LICENSE')))
})
