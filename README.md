# postkasten

Scheduled social posts from a git repository. Posts are Markdown files, the publish log is a JSONL file next to them, and a cron job (GitLab schedule, GitHub Actions, plain crontab) runs `postkasten publish` every few minutes. No database, no service to keep alive, no runtime dependencies.

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
npm install github:derblub/postkasten#v0.1.0
npx postkasten --help
```

Start from [`examples/content-repo`](examples/content-repo): copy it into a private repository, add posts, set the CI variables, create the schedules. [`docs/ci.md`](docs/ci.md) has the details, [`examples/github-actions`](examples/github-actions) the GitHub variant.

## Commands

| Command | What it does |
| --- | --- |
| `validate [--offline]` | Schema, offsets, lengths (3000 characters LinkedIn after escaping, 300 graphemes Bluesky), forbidden phrases, link reachability, image type and size |
| `plan [--all]` | Upcoming posts as a calendar with their state per channel |
| `publish [--dry-run] [--now ISO]` | Posts everything that is due. `--dry-run` prints every request it would send, redacted, and touches nothing |
| `doctor` | Credentials, LinkedIn token expiry (warns at 14, 7, 3 and 1 days), API version age, open intents |
| `linkedin auth` | Browser login, prints a 60-day token and the command to store it in CI |
| `linkedin test-post` / `linkedin delete <urn>` | A connections-only post to check the rendering, and its removal |
| `bluesky profile` | Sets display name and bio from `profile/bluesky.md`; avatar and banner stay |
| `bluesky test-post` / `bluesky delete <rkey>` | Same for Bluesky |
| `resolve <file> <channel> --published <id> \| --drop` | Closes an open intent by hand |

`channels` in the config (default both) lets you run one channel before the other account is connected; see [docs/ci.md](docs/ci.md).

Credentials come from the environment: `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`, `NTFY_TOPIC` (optional, ntfy.sh notifications). Settings live in `postkasten.config.json` (time zone, due window, LinkedIn API version, branch).

## How publishing stays safe

The hard part of a git-backed scheduler is "posted, but the state never made it back". LinkedIn does not let an app read its own posts, so the log has to be right by construction:

1. **Preflight.** Before anything is posted: fetch, check out the branch, `git push --dry-run`. If the push would fail, nothing is posted.
2. **Intent first.** For every (post, channel) an `intent` line is committed and pushed. Then the post goes out. Then a `published` line is committed and pushed.
3. **An open intent blocks.** If a run finds an `intent` without a result, it does not post that item again; it sends a notification and waits for `resolve`.
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

MIT. Built for [pushingpixels.at](https://pushingpixels.at).
