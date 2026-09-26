# Bluesky setup

1. In the Bluesky app: Settings > Privacy and security > App passwords > Add. Name it `postkasten`. Do not grant access to direct messages.
2. Store `BLUESKY_HANDLE` (e.g. `you.example.com`) and `BLUESKY_APP_PASSWORD` as masked, protected CI variables.

That is all. Sessions are created per run with `com.atproto.server.createSession`; nothing is cached.

## What gets posted

An `app.bsky.feed.post` record with:

- `text` (at most 300 graphemes), `langs` (`bluesky.lang`, default `en`), `createdAt` = time of publishing
- `facets` for hashtags and any links in the text, with UTF-8 byte offsets
- an `app.bsky.embed.external` card from `link`: title and description from the page's Open Graph tags (or overrides), thumbnail uploaded as a blob (PNG/JPEG under 1 MB)

Before posting, the account's last 50 posts are checked; a post with the same text and (if the new post has a link) the same card URL counts as already published. Sharing a link again with new text posts normally.

## Profile

`profile/bluesky.md`:

```markdown
---
displayName: Your Name
avatar: avatar.png   # optional, relative to the profile file
---
Bio, at most 256 graphemes.
```

`npx postkasten bluesky profile` merges display name, bio and (if given) avatar into the existing profile record. Banner and anything else stay as they are. `--dry-run` prints what would be sent.

## Test post

```sh
npx postkasten bluesky test-post
npx postkasten bluesky delete <rkey>
```
