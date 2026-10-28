# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- The tests run in GitHub Actions on Node 24 and 26, together with `npm run lint`. Dependabot proposes updates of the actions and the npm packages once a month.
- Issue and pull request templates, a contributing guide, a code of conduct and a security policy.

### Changed

- Vitest 5 instead of 3 for the tests.

## [0.1.3] - 2026-10-09

### Added

- `validate` warns when two Bluesky posts have the same text and the same card link: `publish` would take the second one for the first, already on the platform, and skip it.
- `publish` re-reads queue and state after the git preflight, so a stale CI checkout (a retried job, a queued run) cannot post the same item again.
- Timeouts on every request to LinkedIn, Bluesky, Open Graph pages, images and ntfy, and size limits for pages and images.
- `publish --dry-run` redacts passwords and tokens in the requests it prints.

### Changed

- A create request whose outcome is unknown (network error, timeout, 5xx, 408, 429, or an answer without an id) leaves its intent open instead of writing `failed`, so the item is never retried blindly.
- When the push of a `published` line fails, the notification says "state lost" and names the `resolve` command, instead of reporting a failure on the platform.
- Open Graph fetch, login and the LinkedIn user lookup happen before the intent is written, once per run. The Open Graph fetch is skipped when `title`, `description` and `image` are all set in the post.
- A rejected push of the state file is retried on top of origin without leaving the repository in the middle of a rebase. An intent is checked against origin again before it is written once more.
- The Bluesky duplicate check needs text and card link to match. 0.1.2 matched on the link alone and swallowed a second post about the same page.
- `doctor` warns 14, 7, 3 and 1 days before the LinkedIn token expires, urgent from 3 days, as the docs say.
- A post that is due but invalid sends a notification and makes `publish` exit with 1.
- An empty environment variable counts as unset. A malformed `LINKEDIN_VERSION` only fails the LinkedIn commands.
- `bluesky profile --file` accepts absolute paths. A wrong option prints one line instead of a stack trace.
- The GitHub Actions example runs into the evening in winter as well, and the examples use `npm install`.

### Fixed

- `at` with a day that does not exist, such as 31 September, is an error instead of rolling over into the next month.
- Front matter with a UTF-8 BOM, escaped quotes, or text after a closing quote is read correctly or rejected with a message.
- Bluesky facets: trailing punctuation outside ASCII, parentheses in URLs and hashtags with digits.
- Card titles and descriptions are cut between graphemes, never inside an emoji.
- The forbidden phrases also apply to the `title` and `description` overrides.
- `og:image` is resolved against the address after redirects. Decoding HTML entities never throws, and `>` inside a quoted attribute no longer ends a tag.
- Reading the Bluesky profile treats only `RecordNotFound` as "no profile yet".

## [0.1.2] - 2026-09-22

### Added

- `channels` in `postkasten.config.json` (default `["linkedin", "bluesky"]`) lists the channels the publisher serves. A channel that is not listed is left alone, so one account can go live before the other is connected.

## [0.1.1] - 2026-09-22

### Fixed

- `bluesky delete` accepts a bare record key as well as an `at://` URI or a bsky.app address.

## [0.1.0] - 2026-09-22

### Added

- Posts as Markdown files with front matter in a git repository, one section per channel, published to LinkedIn (personal profile, Posts API) and Bluesky (AT Protocol) by a cron job.
- `state/published.jsonl` as the publish log, with an intent committed and pushed before each post goes out and a `published` line after it.
- Commands `validate`, `plan`, `publish` with `--dry-run`, `doctor`, `resolve`, `linkedin auth`, `linkedin test-post`, `linkedin delete`, `bluesky profile`, `bluesky test-post` and `bluesky delete`.
- Link cards from the page's Open Graph tags, overridable per channel.
- Notifications through ntfy.
- Examples for a content repository with GitLab CI and for GitHub Actions.

[Unreleased]: https://github.com/derblub/postkasten/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/derblub/postkasten/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/derblub/postkasten/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/derblub/postkasten/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/derblub/postkasten/commits/v0.1.0
