# Security policy

## Supported versions

Security fixes go into the latest tag. Please upgrade before reporting.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through [GitHub's vulnerability reporting](https://github.com/derblub/postkasten/security/advisories/new) or by email to [daniel@pushingpixels.at](mailto:daniel@pushingpixels.at).

You will get an answer within five working days. Once a fix is released, the report is credited in the changelog unless you prefer otherwise.

## What it does with your data

postkasten runs on the machine or CI runner where you start it and keeps no data of its own anywhere else. It talks to these services, and only to these:

- LinkedIn (`api.linkedin.com`, `www.linkedin.com` for `linkedin auth`) and the Bluesky server in `bskyService` (`https://bsky.social` by default), to post, delete, set the profile and read your recent Bluesky posts for the duplicate check.
- The pages a post links to, and the images it names, to read their Open Graph tags and upload the card image.
- ntfy (`https://ntfy.sh`), only when `NTFY_TOPIC` is set. Anyone who knows the topic name can read its messages, which name post files, channels and errors. Choose a topic name nobody can guess.
- The git remote of your content repository, to which it pushes `state/published.jsonl`.

Credentials come from the environment and are never written to the state file or the repository. `publish --dry-run` prints every request it would send with the `Authorization` header and secret fields redacted, and git errors have credentials in remote URLs masked. `linkedin auth` prints the new access token on your terminal so that you can store it in your CI variables: run it on your own machine, not in a shared log.
