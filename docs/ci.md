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

See [`examples/github-actions/publish.yml`](../examples/github-actions/publish.yml). Cron is UTC and may run minutes late; scheduled workflows in repositories without activity for 60 days are paused. `GITHUB_TOKEN` with `contents: write` is enough for the state push.

## Plain cron

```
*/15 6-20 * * 1-5  cd /srv/social-posts && git pull -q --rebase && npx postkasten publish >> publish.log 2>&1
```

with the variables in the environment or a `.env` sourced before the command.

## What a run does

1. Reads the config and validates the queue offline. Invalid files are skipped and listed.
2. Collects due (file, channel) pairs without a `published` line, without an open `intent`, with fewer than three `failed` lines for this `at` and no `skipped` line for this `at`.
3. Nothing due: exit 0, no git access at all.
4. Git preflight: fetch, `checkout -B <branch> origin/<branch>`, `push --dry-run`. Fails: notify, exit 1, nothing posted.
5. Per candidate: `skipped` if beyond the due window; otherwise `intent` → publish → `published`, each line committed and pushed at once. Failures write a `failed` line and continue with the next candidate.
6. Exit code 1 if anything failed or was blocked, so the pipeline shows red.

## Notifications

With `NTFY_TOPIC` set, every published post, skip, failure, open intent and doctor finding is one ntfy message (title, priority, tags, click URL). Subscribe to the topic in the ntfy app.

## Recovering

| Symptom | Meaning | What to do |
| --- | --- | --- |
| "open intent" | An attempt started and its result never reached the log (job killed, push failed). | Check the platform. `postkasten resolve <file> <channel> --published <id>` if it is there, `--drop` if not. Commit, push. |
| "post skipped" | The schedule did not run for more than `dueWindowHours`. | Set a new `at`. |
| "giving up" | Three failures for the same `at`. | Read the error in the ntfy message or the log, fix, set a new `at`. |
| "git preflight failed" | Token expired, branch protection, or the remote moved. | Fix the access; the next run picks up where it stopped. |
| doctor: "token is no longer active" | LinkedIn token expired. | `postkasten linkedin auth`, update the variable. |
