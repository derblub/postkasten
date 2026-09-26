# CI and operations

The content repo is private (planned posts should not be public), the tool is public. The repo needs three things: a scheduler that runs `postkasten publish` often enough, credentials as CI variables, and permission to push the publish log back.

## GitLab

Copy [`examples/content-repo/.gitlab-ci.yml`](../examples/content-repo/.gitlab-ci.yml). Jobs:

- `publish`: runs on a schedule with `TASK=publish` and on manual "Run pipeline". `resource_group: publish` serialises concurrent runs.
- `doctor`: daily schedule with `TASK=doctor`.
- `validate`: on every push, so a new post is checked immediately. State commits are pushed with `-o ci.skip` and trigger nothing.

Schedules (CI/CD > Schedules), time zone set to your zone:

| Description | Cron | Variable |
| --- | --- | --- |
| publish | `*/15 6-20 * * 1-5` | `TASK=publish` |
| doctor | `0 7 * * *` | `TASK=doctor` |

Variables (Settings > CI/CD > Variables, masked and protected):

| Variable | Used by |
| --- | --- |
| `LINKEDIN_ACCESS_TOKEN` | publish, doctor |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | doctor (token introspection), local `linkedin auth` |
| `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` | publish, doctor |
| `NTFY_TOPIC` | notifications (optional; `NTFY_SERVER` for a self-hosted ntfy) |
| `GIT_PUSH_TOKEN` | pushing `state/published.jsonl` back |

`GIT_PUSH_TOKEN` is a project access token with role Developer and scope `write_repository`. If `main` is protected, allow the token's bot user to push (Settings > Repository > Protected branches). The job rewrites the origin URL to `https://oauth2:${GIT_PUSH_TOKEN}@…`; the token never appears in logs (git output is redacted and GitLab masks the variable).

## GitHub Actions

See [`examples/github-actions/publish.yml`](../examples/github-actions/publish.yml). Cron is UTC and does not follow daylight saving time, so the example uses `*/15 4-19 * * 1-5`: 4-19 UTC is 05:00-20:45 CET in winter and 06:00-21:45 CEST in summer, a superset of 06:00-20:45 Europe/Vienna time all year (one harmless extra hour in each season). Widen the range by one hour for your zone the same way; a post that falls outside the window by more than `dueWindowHours` (Friday evening, weekend) is skipped. Cron may run minutes late; scheduled workflows in repositories without activity for 60 days are paused. `GITHUB_TOKEN` with `contents: write` is enough for the state push.

## Plain cron

```
*/15 6-20 * * 1-5  cd /srv/social-posts && git pull -q --rebase && npx postkasten publish >> publish.log 2>&1
```

with the variables in the environment or a `.env` sourced before the command.

## What a run does

1. Reads the config and validates the queue offline. Invalid files are skipped and listed.
2. Collects due (file, channel) pairs without a `published` line, without an open `intent`, with fewer than three `failed` lines for this `at` and no `skipped` line for this `at`.
3. Nothing due and nothing to report: no git access at all. Open intents and due invalid posts (step 6) are reported only after the preflight in step 4, so a stale checkout raises no false alarm.
4. Git preflight: fetch, `checkout -B <branch> origin/<branch>`, `push --dry-run -o ci.skip` (the same push options the real pushes use). Fails: notify, exit 1, nothing posted.
5. Steps 1 and 2 run again on the synced tree, and only this pass counts. A retried or queued CI job that checked out an older commit therefore sees the lines earlier runs pushed and does not post twice.
6. A due post that is invalid (for example a new rule in `rules/forbidden.txt` matches it, or its `at` offset no longer fits the time zone) is not posted: one notification per run lists the files and reasons, and the run exits 1. Posts that are not due yet, or more than `dueWindowHours` overdue, only show up in the log. Files that cannot be parsed have no known `at`; `postkasten validate` reports them.
7. Per candidate:
   - `skipped` if beyond the due window.
   - Read-only preparation: Open Graph page and image (fetched once per URL per run, the page not at all when `title`, `description` and `image` are all set), Bluesky login, LinkedIn userinfo (once per channel per run). A failure here writes a `failed` line without an `intent`.
   - `intent` → create the post → `published`, each line committed and pushed at once. A failure before the create request, or a definite rejection of it (HTTP 4xx other than 408/429), writes a `failed` line and the run continues with the next candidate.
   - When the create request may have gone through (network error, timeout, 5xx, 408, 429, no id in the answer), no `failed` line is written: the intent stays open, the post counts as blocked from the next run on, and a notification asks you to check the platform and run `postkasten resolve`.
   - If the `intent` line cannot be pushed, or another run pushed a line for the same (file, channel) or changed the post in the meantime, the run stops before posting. If the `published` line cannot be pushed after the post went out, the run stops with a "state lost" notification that carries the post's id/URL and the exact `postkasten resolve … --published <id>` command; nothing is recorded as failed.
8. Exit code 1 if anything failed, was blocked or is a due invalid post, so the pipeline shows red.

State pushes: a rejected push (for example a `resolve` pushed during a run) is retried once on top of origin: the branch is moved to origin and the line appended again. An `intent` line is appended again only if origin still has the (file, channel) pending and the post unchanged; otherwise the run stops without posting. The working copy is never left mid-rebase.

## Enabling channels one at a time

`channels` in `postkasten.config.json` (default `["linkedin", "bluesky"]`) lists the channels the publisher serves. A channel that is not listed is left alone: its posts stay pending, no state line is written, `doctor` skips its checks. Useful while one account is not connected yet. When you enable it later, posts whose `at` is already past the due window get a `skipped` line on the next run; set a new `at` for the ones you still want out. A file whose other channel was already published keeps that `published` line whatever `at` says.

## Notifications

With `NTFY_TOPIC` set, every published post, skip, failure, unknown outcome, open intent, lost state line, due invalid post and doctor finding is one ntfy message (title, priority, tags, click URL). Subscribe to the topic in the ntfy app.

## Recovering

| Symptom | Meaning | What to do |
| --- | --- | --- |
| "open intent" / "outcome unknown" | An attempt started and its result never reached the log (job killed, push failed, or the create request failed in a way that does not prove nothing was posted). | Check the platform. `postkasten resolve <file> <channel> --published <id>` if it is there, `--drop` if not. Commit, push. |
| "state lost" | The post is live but its `published` line could not be pushed. The run stopped. | Run the `postkasten resolve … --published <id>` command from the message, commit, push. Then fix the push access. |
| "due post is invalid" | A due post within `dueWindowHours` fails validation and is not posted. Past the window it is only logged. | `postkasten validate`, fix the file (or the rule/config). If it is now beyond `dueWindowHours`, set a new `at`. |
| "post skipped" | The schedule did not run for more than `dueWindowHours`. | Set a new `at`. |
| "giving up" | Three failures for the same `at`. | Read the error in the ntfy message or the log, fix, set a new `at`. |
| "git preflight failed" | Token expired, branch protection, or the remote moved. | Fix the access; the next run picks up where it stopped. |
| doctor: "token is no longer active" | LinkedIn token expired. | `postkasten linkedin auth`, update the variable. |
