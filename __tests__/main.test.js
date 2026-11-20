/**
 * Unit tests for src/main.js, with @actions/core and @actions/github mocked.
 */
import fs from 'node:fs'
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import * as github from '../__fixtures__/github.js'

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/github', () => github)

const { run } = await import('../src/main.js')
const { octokit, context } = github
const config = fs.readFileSync('.github/auto-labeler.yml', 'utf8')
const pr = (number, title, extra = {}) => ({
  number,
  title,
  body: '',
  user: { login: 'me' },
  labels: [],
  ...extra
})

describe('main.js', () => {
  let prs

  beforeEach(() => {
    prs = []
    core.getInput.mockImplementation(
      (name) =>
        ({ 'configuration-path': '.github/auto-labeler.yml' })[name] ?? ''
    )
    core.getBooleanInput.mockReturnValue(true)
    github.getOctokit.mockReturnValue(octokit)
    octokit.rest.repos.getContent.mockResolvedValue({ data: config })
    octokit.paginate.mockImplementation(async (endpoint, params, mapFn) => {
      if (endpoint === octokit.rest.issues.listLabelsForRepo)
        return ['enhancement', 'bug', 'breaking-change', 'question'].map(
          (name) => ({ name })
        )
      if (endpoint === octokit.rest.pulls.listFiles) return []
      const { state } = params
      const data = prs.filter((p) =>
        state === 'open' ? !('merged_at' in p) : 'merged_at' in p
      )
      if (!mapFn) return data
      return mapFn({ data }, () => {})
    })
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('labels the triggering PR, skipping missing and keeping unmanaged labels', async () => {
    context.payload = {
      pull_request: pr(1, 'feat!: a', {
        labels: [{ name: 'bug' }, { name: 'question' }]
      })
    }
    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: 'o',
      repo: 'r',
      issue_number: 1,
      labels: ['breaking-change', 'enhancement']
    })
    expect(octokit.rest.issues.removeLabel).toHaveBeenCalledTimes(1)
    expect(octokit.rest.issues.removeLabel).toHaveBeenCalledWith({
      owner: 'o',
      repo: 'r',
      issue_number: 1,
      name: 'bug'
    })
    expect(core.setOutput).toHaveBeenCalledWith(
      'new-labels',
      'breaking-change,enhancement'
    )
    expect(core.setOutput).toHaveBeenCalledWith(
      'all-labels',
      'question,breaking-change,enhancement'
    )
    expect(core.warning).toHaveBeenCalledWith(
      'Label "documentation" does not exist in o/r; skipping it'
    )
  })

  it('backfills open PRs and PRs merged since the latest release', async () => {
    context.payload = {}
    octokit.rest.repos.getLatestRelease.mockResolvedValue({
      data: { published_at: '2026-01-01T00:00:00Z' }
    })
    prs = [
      pr(20, 'feat: open'),
      pr(21, 'fix: new', {
        merged_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z'
      }),
      pr(22, 'fix: closed', {
        merged_at: null,
        updated_at: '2026-02-01T00:00:00Z'
      }),
      pr(23, 'fix: old', {
        merged_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z'
      })
    ]
    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(
      octokit.rest.issues.addLabels.mock.calls.map(
        ([args]) => args.issue_number
      )
    ).toEqual([20, 21])
  })

  it('fails the step on API errors', async () => {
    context.payload = { pull_request: pr(1, 'feat: a') }
    octokit.rest.repos.getContent.mockRejectedValue(new Error('Not Found'))
    await run()
    expect(core.setFailed).toHaveBeenCalledWith('Not Found')
  })
})
