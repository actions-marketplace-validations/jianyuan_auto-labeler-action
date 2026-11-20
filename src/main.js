import * as core from '@actions/core'
import * as github from '@actions/github'
import { parse } from 'yaml'
import { labelsFor } from './match.js'

/**
 * Labels the triggering PR, or on any other event (e.g. workflow_dispatch)
 * the open PRs and PRs merged since the latest release.
 *
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run() {
  try {
    const octokit = github.getOctokit(core.getInput('repo-token'))
    const configPath = core.getInput('configuration-path')
    const syncLabels = core.getBooleanInput('sync-labels')
    const { context } = github
    const { owner, repo } = context.repo

    // Read through the API at the workflow's commit, so pull_request_target never touches PR code.
    const { data: configText } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: configPath,
      ref: context.sha,
      mediaType: { format: 'raw' }
    })
    /** @type {import('./match.js').Config} */
    const config = parse(configText)

    const repoLabels = await octokit.paginate(
      octokit.rest.issues.listLabelsForRepo,
      { owner, repo, per_page: 100 }
    )
    const existing = new Set(repoLabels.map((label) => label.name))
    // addLabels silently creates missing labels, so only apply ones the repo already has.
    const managed = new Set()
    for (const name of Object.keys(config)) {
      if (existing.has(name)) managed.add(name)
      else
        core.warning(
          `Label "${name}" does not exist in ${owner}/${repo}; skipping it`
        )
    }

    /**
     * @param {import('./match.js').PullRequest} pr
     * @returns {Promise<{ added: string[], all: string[] }>}
     */
    async function label(pr) {
      const getFiles = async () =>
        (
          await octokit.paginate(octokit.rest.pulls.listFiles, {
            owner,
            repo,
            pull_number: pr.number,
            per_page: 100
          })
        ).map((file) => file.filename)
      const wanted = new Set(
        (await labelsFor(config, pr, getFiles)).filter((name) =>
          managed.has(name)
        )
      )
      const current = new Set(pr.labels.map((l) => l.name ?? ''))
      const toAdd = [...wanted].filter((name) => !current.has(name))
      const toRemove = syncLabels
        ? [...current].filter((name) => managed.has(name) && !wanted.has(name))
        : []

      const issue = { owner, repo, issue_number: pr.number }
      if (toAdd.length > 0) {
        await octokit.rest.issues.addLabels({ ...issue, labels: toAdd })
      }
      for (const name of toRemove) {
        await octokit.rest.issues.removeLabel({ ...issue, name })
      }
      core.info(
        `#${pr.number} ${pr.title}: added ${toAdd.join(', ') || 'none'}; removed ${toRemove.join(', ') || 'none'}`
      )
      const all = [...current].filter((name) => !toRemove.includes(name))
      return { added: toAdd, all: [...all, ...toAdd] }
    }

    if (context.payload.pull_request) {
      const { added, all } = await label(context.payload.pull_request)
      core.setOutput('new-labels', added.join(','))
      core.setOutput('all-labels', all.join(','))
      return
    }

    let since = null
    try {
      const { data: release } = await octokit.rest.repos.getLatestRelease({
        owner,
        repo
      })
      since = release.published_at ?? release.created_at
    } catch (error) {
      if (error.status !== 404) throw error
    }
    const open = await octokit.paginate(octokit.rest.pulls.list, {
      owner,
      repo,
      state: 'open',
      per_page: 100
    })
    // Sorted by last update, so paging can stop once PRs predate the latest release.
    const merged = await octokit.paginate(
      octokit.rest.pulls.list,
      {
        owner,
        repo,
        state: 'closed',
        sort: 'updated',
        direction: 'desc',
        per_page: 100
      },
      (response, done) => {
        if (since && response.data.some((pr) => pr.updated_at < since)) done()
        return response.data.filter(
          (pr) => pr.merged_at && (!since || pr.merged_at > since)
        )
      }
    )
    for (const pr of [...open, ...merged]) {
      await label(pr)
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}
