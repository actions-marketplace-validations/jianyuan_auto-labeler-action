import { posix } from 'node:path'

/**
 * @typedef {object} PullRequest
 * @property {number} number
 * @property {string} title
 * @property {string | null} [body]
 * @property {{ login: string } | null} [user]
 * @property {{ ref: string }} [head]
 * @property {{ ref: string }} [base]
 * @property {{ name?: string }[]} labels
 */

/**
 * A matcher holds when all of its conditions hold.
 *
 * @typedef {object} Matcher
 * @property {string | string[]} [title]
 * @property {string | string[]} [body]
 * @property {string | string[]} ['head-branch']
 * @property {string | string[]} ['base-branch']
 * @property {string | string[]} [author]
 * @property {string | string[]} [files]
 * @property {string | string[]} ['any-file']
 * @property {Matcher} [not]
 */

/**
 * Label name to matchers. A label applies when any of its matchers holds.
 *
 * @typedef {Record<string, Matcher | Matcher[]>} Config
 */

const list = (value) => [value].flat()
const anyRegex = (patterns, text) =>
  list(patterns).some((p) => new RegExp(p, 'm').test(text ?? ''))
const anyGlob = (globs, file) =>
  list(globs).some((g) => posix.matchesGlob(file, g))
const fileKeys = new Set(['files', 'any-file'])

/**
 * File conditions go last so typed titles skip the file-list API call.
 *
 * @param {Matcher} matcher
 * @param {PullRequest} pr
 * @param {() => Promise<string[]>} getFiles
 * @returns {Promise<boolean>}
 */
async function matches(matcher, pr, getFiles) {
  const entries = Object.entries(matcher).sort(
    ([a], [b]) => Number(fileKeys.has(a)) - Number(fileKeys.has(b))
  )
  for (const [key, value] of entries) {
    let ok
    switch (key) {
      case 'title':
        ok = anyRegex(value, pr.title)
        break
      case 'body':
        ok = anyRegex(value, pr.body)
        break
      case 'head-branch':
        ok = anyRegex(value, pr.head?.ref)
        break
      case 'base-branch':
        ok = anyRegex(value, pr.base?.ref)
        break
      case 'author':
        ok = list(value).includes(pr.user?.login ?? '')
        break
      case 'files': {
        const files = await getFiles()
        ok = files.length > 0 && files.every((file) => anyGlob(value, file))
        break
      }
      case 'any-file':
        ok = (await getFiles()).some((file) => anyGlob(value, file))
        break
      case 'not':
        ok = !(await matches(value, pr, getFiles))
        break
      default:
        throw new Error(`Unknown condition "${key}"`)
    }
    if (!ok) return false
  }
  return true
}

/**
 * Returns the config labels the PR should have, fetching its files at most once.
 *
 * @param {Config} config
 * @param {PullRequest} pr
 * @param {() => Promise<string[]>} getFiles
 * @returns {Promise<string[]>}
 */
export async function labelsFor(config, pr, getFiles) {
  let files
  const cachedFiles = async () => (files ??= await getFiles())
  const wanted = []
  for (const [label, matchers] of Object.entries(config)) {
    for (const matcher of list(matchers)) {
      if (await matches(matcher, pr, cachedFiles)) {
        wanted.push(label)
        break
      }
    }
  }
  return wanted
}
