# Contributing

Thanks for taking the time. The most useful contribution is a post that went out wrong: twice, not at all, with a broken link card, or cut in the wrong place.

## Reporting a problem

Open an [issue](https://github.com/derblub/postkasten/issues/new/choose) with:

- the command you ran and its output,
- the post file, and the lines of `state/published.jsonl` for it,
- the tag you install, such as `github:derblub/postkasten#v0.1.3`, and where it runs (GitLab CI, GitHub Actions, crontab).

Remove tokens, handles and anything private first. `publish --dry-run` prints the requests with credentials already redacted.

## Development setup

You need Node 24 or newer and git.

```console
$ git clone https://github.com/derblub/postkasten
$ cd postkasten
$ npm install
$ npm test
```

The tests need no account and no network: both API clients run against fixtures, and `publish` runs against a fetch double and temporary git repositories. Before you open a pull request, run `npm test` and `npm run lint` and add an entry under "Unreleased" in `CHANGELOG.md`.

## Where things live

| File | What it does |
| --- | --- |
| `bin/postkasten.js` | The command line: options, help, one module per command in `src/cli/` |
| `src/publish.js` | The publish run: preflight, intent, post, `published` line, notifications |
| `src/state.js`, `src/git.js` | The publish log and the commits and pushes that carry it |
| `src/queue.js`, `src/frontmatter.js`, `src/schedule.js` | Post files, their front matter, `at` with its offset and the due window |
| `src/validate.js`, `src/text/` | Checks before publishing: lengths, graphemes, Bluesky facets, LinkedIn escaping, forbidden phrases |
| `src/og.js` | Open Graph tags and card images |
| `src/linkedin/`, `src/bluesky/` | The two API clients, LinkedIn login and the Bluesky profile |
| `src/dryrun.js` | The recording behind `--dry-run`, with credentials redacted |
| `src/notify.js` | ntfy notifications |
| `examples/` | A content repository with GitLab CI, and the GitHub Actions variant |
| `docs/assets/` | Brand files. Do not edit or redraw them |

postkasten has no runtime dependencies. Please keep it that way: it runs in a CI job every few minutes and should install in a second.
