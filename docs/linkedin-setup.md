# LinkedIn setup

postkasten posts to a **personal profile** with the official Posts API. Company pages need the Community Management API, which LinkedIn grants on application; not covered here.

## What the API can and cannot do

- Post text with an article card (link, title, description, thumbnail): yes.
- Read your own posts back: no (`r_member_social` is restricted). This is why postkasten keeps its own log, see the README.
- Edit your profile (headline, about): no, for anyone. Do that by hand.
- Refresh tokens: only for Marketing Developer Platform partners. Everyone else logs in again every 60 days.

## One-time setup

1. Create an app at <https://www.linkedin.com/developers/apps>. An app needs a LinkedIn Page to be associated with; a minimal page for your business is enough.
2. Under **Products**, request **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**. Both are self-serve and usually granted within minutes.
3. Under **Auth**, add the redirect URL `http://localhost:8787/callback` and note the Client ID and Client Secret.
4. Log in once:

   ```sh
   export LINKEDIN_CLIENT_ID=... LINKEDIN_CLIENT_SECRET=...
   npx postkasten linkedin auth
   ```

   The browser opens LinkedIn, you approve the scopes `openid profile w_member_social`, and the command prints the token, its expiry date and a `glab variable set` command for GitLab.

5. Store `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` as masked, protected CI variables. Client ID and secret are only used by `doctor` to introspect the token.

## Verify the rendering once

```sh
npx postkasten linkedin test-post
```

posts a connections-only test with parentheses, underscores and a hashtag and prints the URN. Check that `#Hashtag` renders as a hashtag and the other characters appear literally, then

```sh
npx postkasten linkedin delete <urn>
```

Findings so far: LinkedIn's "little" format needs `\` before `\ | { } @ [ ] ( ) < > # * _ ~`; a `#` directly followed by a word character is left unescaped so it stays a hashtag.

## Token renewal (every 60 days)

The daily `doctor` job calls `introspectToken` and sends an ntfy warning 14, 7, 3 and 1 days before expiry, and immediately when the token is no longer active. Renewal is the four lines under step 4 plus updating the CI variable. Put the expiry date in your calendar as well.

## API version

Requests carry `LinkedIn-Version: YYYYMM` (`linkedinVersion` in `postkasten.config.json`, or `LINKEDIN_VERSION`). LinkedIn sunsets versions after about a year; `doctor` warns when the configured version is ten months old. Bump it and run `validate` and a dry run.
