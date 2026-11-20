import { jest } from '@jest/globals'

export const context = {
  repo: { owner: 'o', repo: 'r' },
  sha: 'abc',
  payload: {}
}

export const octokit = {
  rest: {
    repos: { getContent: jest.fn(), getLatestRelease: jest.fn() },
    issues: {
      listLabelsForRepo: jest.fn(),
      addLabels: jest.fn(),
      removeLabel: jest.fn()
    },
    pulls: { listFiles: jest.fn(), list: jest.fn() }
  },
  paginate: jest.fn()
}

export const getOctokit = jest.fn()
