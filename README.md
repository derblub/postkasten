<div align="center">

<a href="https://pushingpixels.at">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/logo-light.svg">
    <img src="docs/assets/logo.svg" alt="Pushing Pixels" width="96">
  </picture>
</a>

<h1>postkasten</h1>

<p><strong>Schedule LinkedIn and Bluesky posts as Markdown files in git and publish them from a cron job.</strong></p>

<p>
  <a href="https://github.com/derblub/postkasten/actions/workflows/ci.yml"><img src="https://github.com/derblub/postkasten/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/derblub/postkasten/tags"><img src="https://img.shields.io/github/v/tag/derblub/postkasten?sort=semver&label=version&cacheSeconds=3600" alt="Version"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fderblub%2Fpostkasten%2Fmain%2Fpackage.json&query=%24.engines.node&label=node&cacheSeconds=3600" alt="Node version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
</p>

<p>
  <a href="#install">Install</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#how-publishing-stays-safe">How publishing stays safe</a> ·
  <a href="#time-zones">Time zones</a> ·
  <a href="#docs">Docs</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

</div>

---

Posts are Markdown files, the publish log is a JSONL file next to them, and a cron job (GitLab schedule, GitHub Actions, plain crontab) runs `postkasten publish` every few minutes. No database, no service to keep alive, no runtime dependencies.

Channels: **LinkedIn** (personal profile, via the official Posts API) and **Bluesky** (AT Protocol). Neither platform schedules posts server-side, so the scheduler has to live somewhere; this puts it where your text already is.

```
posts/2026-09-29-zero-downtime-migrations.md
```

```markdown
---
at: 2026-09-29T08:30:00+02:00
linkedin:
  link: https://example.com/de/portfolio/zero-downtime-migrations
bluesky:
  link: https://example.com/portfolio/zero-downtime-migrations
---
## linkedin
German text for LinkedIn, with the link and at most two hashtags.

https://example.com/de/portfolio/zero-downtime-migrations

#Django #PostgreSQL

## bluesky
English text for Bluesky, 300 graphemes at most. The link card comes from `link`.

#Django #PostgreSQL
```

Title, description and image of the link card are read from the page's Open Graph tags at publish time (LinkedIn does not scrape links posted through its API). Override them per channel with `title`, `description`, `image`.

## Install

Node 24 or newer.

```sh
npm install github:derblub/postkasten#v0.1.3
npx postkasten --help
```

Start from [`examples/content-repo`](examples/content-repo): copy it into a private repository, add posts, set the CI variables, create the schedules. [`docs/ci.md`](docs/ci.md) has the details, [`examples/github-actions`](examples/github-actions) the GitHub variant.

## Commands

| Command | What it does |
| --- | --- |
| `validate [--offline]` | Schema, offsets, lengths (3000 characters LinkedIn after escaping, 300 graphemes Bluesky), forbidden phrases, link reachability, image type and size |
| `plan [--all]` | Upcoming posts as a calendar with their state per channel |
| `publish [--dry-run] [--now ISO]` | Posts everything that is due. `--dry-run` prints every request it would send, redacted, and touches nothing |
| `doctor` | Credentials, LinkedIn token expiry (warns at 14, 7, 3 and 1 days, urgent from 3), API version age, open intents |
| `linkedin auth` | Browser login, prints a 60-day token and the command to store it in CI |
| `linkedin test-post` / `linkedin delete <urn>` | A connections-only post to check the rendering, and its removal |
| `bluesky profile` | Sets display name and bio from `profile/bluesky.md`; avatar and banner stay |
| `bluesky test-post` / `bluesky delete <rkey>` | Same for Bluesky |
| `resolve <file> <channel> --published <id> \| --drop` | Closes an open intent by hand |

`channels` in the config (default both) lets you run one channel before the other account is connected; see [docs/ci.md](docs/ci.md).

Credentials come from the environment: `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`, `NTFY_TOPIC` (optional, ntfy.sh notifications). An empty variable counts as unset. Settings live in `postkasten.config.json` (time zone, due window, LinkedIn API version, branch).

## How publishing stays safe

The hard part of a git-backed scheduler is "posted, but the state never made it back". LinkedIn does not let an app read its own posts, so the log has to be right by construction:

1. **Preflight.** Before anything is posted or reported: fetch, check out the branch, `git push --dry-run -o ci.skip`, then read queue and state again from the synced tree. If the push would fail, nothing is posted.
2. **Intent first.** For every (post, channel), everything that cannot create a post (Open Graph fetch, login) happens first. Then an `intent` line is committed and pushed; if another run pushed one for the same item in the meantime, this run stops. Then the post goes out. Then a `published` line is committed and pushed. If that last push fails, a "state lost" notification carries the id and the `resolve` command.
3. **An open intent blocks.** If a run finds an `intent` without a result, it does not post that item again; it sends a notification and waits for `resolve`. A create request whose outcome is unknown (network error, timeout, 5xx, 408, 429) leaves its intent open the same way instead of retrying.
4. **Bluesky is double-checked** against the account's recent posts before posting.
5. **Overdue posts are skipped**, not dumped: anything more than `dueWindowHours` (default 12) past its time gets a `skipped` line and a notification. Re-date it to post it.
6. **Three failures** for the same `at` and the item is left alone until it is re-dated.

`state/published.jsonl` is the whole memory. A `published` line ends a (file, channel) for good; `failed` and `skipped` are bound to `at`. Never rename a post file after it was published.

## Time zones

`at` must carry an explicit offset. `validate` compares it with the configured zone's offset at that instant, so `+02:00` written for a November date is an error, not a surprise. Due checks compare epoch milliseconds. Put your schedule on the same zone (GitLab schedules have a time zone field; GitHub cron is UTC).

## Development

```sh
npm install
npm test
```

Tests cover the pure functions (front matter, graphemes, byte-offset facets with umlauts and emoji, LinkedIn escaping, due logic, state derivation) and both API clients against fixtures. `publish` runs end to end against a fetch double; its recorded requests are snapshotted, and `publish --dry-run` prints the same recording, so the dry run is the live path minus the network.

## Docs

- [Post format](docs/post-format.md)
- [LinkedIn setup and token renewal](docs/linkedin-setup.md)
- [Bluesky setup](docs/bluesky-setup.md)
- [CI and operations](docs/ci.md)

## Contributing

A post that went out twice, not at all or with a broken card is the most useful report. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, and the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues go through [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Daniel Kurdoghlian, Pushing Pixels

---

<div align="center">
  <a href="https://pushingpixels.at">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/assets/pushing-pixels-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="docs/assets/pushing-pixels-light.svg">
      <img src="docs/assets/pushing-pixels.svg" alt="Pushing Pixels" width="320">
    </picture>
  </a>
  <p>Built and maintained by <a href="https://pushingpixels.at">Daniel Kurdoghlian</a> at <a href="https://pushingpixels.at">Pushing Pixels</a> in Vienna.<br>
  I build <a href="https://pushingpixels.at/creates/web-apps">custom software</a> and the pipelines that ship it.</p>
</div>
