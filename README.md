# Auto Labeler

Labels pull requests from a YAML config, like
[actions/labeler](https://github.com/actions/labeler), but it can match on the
PR title, body, author and branches as well as changed files. That makes
Conventional Commit labels (`feat:` → `enhancement`, `fix!:` →
`breaking-change`) a few lines of config.

## Usage

```yaml
# .github/workflows/label-pr.yml
name: Label PR

on:
  pull_request_target:
    types: [opened, edited, reopened, synchronize]
  # Labels open PRs and PRs merged since the latest release.
  workflow_dispatch:

permissions:
  contents: read
  pull-requests: write

jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - uses: jianyuan/auto-labeler-action@v1
```

Create the labels from your config in the repo before the first run. The action
skips labels the repo doesn't have, with a warning, so that GitHub doesn't
create them with a default color.

The action reads its config through the API and never checks out PR code, so it
is safe on `pull_request_target` and labels PRs from forks too.

Run by hand (`workflow_dispatch`, or any event without a PR), it labels open PRs
and PRs merged since the latest release, which are the PRs the next release
notes will list.

## Inputs

| Input                | Default                    | Description                                                             |
| -------------------- | -------------------------- | ----------------------------------------------------------------------- |
| `repo-token`         | `${{ github.token }}`      | Token used to read the config and label PRs                             |
| `configuration-path` | `.github/auto-labeler.yml` | Path to the label config in the repo; labels the repo lacks are skipped |
| `sync-labels`        | `true`                     | Remove configured labels that no longer match                           |

## Outputs

| Output       | Description                                                   |
| ------------ | ------------------------------------------------------------- |
| `new-labels` | Comma-separated labels added to the triggering PR in this run |
| `all-labels` | Comma-separated labels on the triggering PR after this run    |

Both are empty on runs without a triggering PR, such as `workflow_dispatch`.

```yaml
- id: label
  uses: jianyuan/auto-labeler-action@v1
- if: contains(steps.label.outputs.new-labels, 'breaking-change')
  run: echo "This PR is a breaking change"
```

## Config

Each key is a label. The label applies when **any** matcher in its list holds,
and a matcher holds when **all** its conditions hold.

| Condition                    | Holds when                                              |
| ---------------------------- | ------------------------------------------------------- |
| `title`, `body`              | any regex matches (multiline, so `^` matches each line) |
| `head-branch`, `base-branch` | any regex matches the branch name                       |
| `author`                     | the PR author is one of the given logins                |
| `files`                      | every changed file matches one of the globs             |
| `any-file`                   | at least one changed file matches one of the globs      |
| `not`                        | the nested matcher does not hold                        |

Every value can be a single string or a list. Globs use Node's
`path.matchesGlob`, where `**` does not enter dot directories, so write
`.github/**` explicitly.

With `sync-labels`, each run removes config labels that no longer match; labels
not in the config are left alone.

```yaml
breaking-change:
  - title: '^\w+(\([^)]*\))?!:'
  - body: '^BREAKING[ -]CHANGE:'

enhancement:
  - title: '^feat(\([^)]*\))?!?:'

documentation:
  - title: '^docs(\([^)]*\))?!?:'
  # Untyped titles fall back to the changed files.
  - files: ['**/*.md', 'docs/**']
    not:
      title: '^\w+(\([^)]*\))?!?:'

dependencies:
  - title: '^\w+\(deps\)!?:'
  - author: [renovate[bot], dependabot[bot]]
```

See [`.github/auto-labeler.yml`](.github/auto-labeler.yml) for a full
Conventional Commits config.

## Development

```bash
npm install
npm test
npm run bundle # format and rebuild dist/, which must be committed
```
