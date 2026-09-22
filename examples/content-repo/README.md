# Social posts

Post queue for [postkasten](https://github.com/derblub/postkasten). One Markdown file per post under `posts/`, published by the scheduled `publish` job.

## Add a post

1. Copy an existing file in `posts/`, name it `YYYY-MM-DD-topic.md`.
2. Set `at` with the local offset (`+02:00` in summer, `+01:00` in winter; `validate` checks it).
3. Write the `## linkedin` and `## bluesky` sections. Leave a channel out by removing both its front matter block and its section.
4. `npm run validate`, commit, push. The push pipeline validates again.

The post goes out in the first 15-minute slot after `at`. Never rename a file after it was published: the file name is its identity in `state/published.jsonl`.

## Renew the LinkedIn token (every 60 days)

The `doctor` schedule sends an ntfy warning 14, 7, 3 and 1 days before expiry.

```sh
export LINKEDIN_CLIENT_ID=... LINKEDIN_CLIENT_SECRET=...
npx postkasten linkedin auth
```

Paste the printed `glab variable set` command, then run the `doctor` job from CI/CD > Pipelines > Run pipeline to confirm.

## When something goes wrong

- **"open intent"**: a publish attempt started but its result never made it into the state. Check the platform, then `npx postkasten resolve <file> <channel> --published <id>` or `--drop`, commit, push.
- **"skipped"**: the post was more than 12 hours overdue (schedule outage). Change `at` to a new time to post it.
- **"giving up"**: three failures for the same `at`. Fix the cause (see ntfy message), then re-date the post.
