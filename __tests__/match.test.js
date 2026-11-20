import fs from 'node:fs'
import { parse } from 'yaml'
import { labelsFor } from '../src/match.js'

const config = parse(fs.readFileSync('.github/auto-labeler.yml', 'utf8'))
const pr = (title, extra = {}) => ({
  number: 1,
  title,
  body: '',
  user: { login: 'me' },
  labels: [],
  ...extra
})
const labels = (p, files = []) => labelsFor(config, p, async () => files)

describe('labelsFor', () => {
  it('labels from the title type', async () => {
    expect(await labels(pr('feat(api)!: x'))).toEqual([
      'breaking-change',
      'enhancement'
    ])
    expect(
      await labels(pr('fix: y', { body: 'text\nBREAKING CHANGE: z' }))
    ).toEqual(['breaking-change', 'bug'])
    expect(await labels(pr('docs: y'))).toEqual(['documentation'])
    expect(
      await labels(
        pr('chore(deps): bump', { user: { login: 'renovate[bot]' } })
      )
    ).toEqual(['dependencies', 'maintenance'])
    expect(await labels(pr('refactor!: y'))).toEqual([
      'breaking-change',
      'maintenance'
    ])
  })

  it('falls back to changed files only without a typed title', async () => {
    expect(
      await labels(pr('Update README'), ['README.md', 'docs/a.md'])
    ).toEqual(['documentation'])
    expect(
      await labels(pr('Tweak CI'), ['.github/workflows/test.yml'])
    ).toEqual(['maintenance'])
    expect(await labels(pr('Refresh lock'), ['uv.lock'])).toEqual([
      'dependencies'
    ])
    expect(await labels(pr('Mixed'), ['README.md', 'src/a.py'])).toEqual([])
    expect(await labels(pr('feat: y'), ['README.md'])).toEqual(['enhancement'])
    expect(await labels(pr('Empty'), [])).toEqual([])
  })

  it('fetches files lazily and once', async () => {
    let calls = 0
    const getFiles = async () => (calls++, ['README.md'])
    await labelsFor(config, pr('feat: y'), getFiles)
    expect(calls).toBe(0)
    await labelsFor(config, pr('Update'), getFiles)
    expect(calls).toBe(1)
  })

  it('supports branch and any-file conditions', async () => {
    const cfg = {
      a: [{ 'head-branch': '^release/', 'base-branch': ['main'] }],
      b: { 'any-file': 'src/**' }
    }
    const p = pr('x', { head: { ref: 'release/1' }, base: { ref: 'main' } })
    expect(
      await labelsFor(cfg, p, async () => ['src/a.js', 'README.md'])
    ).toEqual(['a', 'b'])
  })

  it('rejects unknown conditions', async () => {
    await expect(
      labelsFor({ a: [{ titel: 'x' }] }, pr('x'), async () => [])
    ).rejects.toThrow('Unknown condition "titel"')
  })
})
