# Post format

One Markdown file per post under `posts/`. The file name is the post's identity in the publish log; name it `YYYY-MM-DD-topic.md` and never rename it after it was published.

```markdown
---
at: 2026-09-29T08:30:00+02:00
linkedin:
  link: https://example.com/de/page
  title: Optional card title
  description: Optional card description
  image: https://example.com/og/de/page.png
bluesky:
  link: https://example.com/page
  lang: en
---
## linkedin
Text for LinkedIn.

## bluesky
Text for Bluesky.
```

## Front matter

| Key | Required | Meaning |
| --- | --- | --- |
| `at` | yes | Publish time with explicit offset (`+02:00`, `+01:00`, `Z`). The post goes out in the first scheduler slot at or after this time. |
| `<channel>` | per channel | A block per channel you want to post to: `linkedin`, `bluesky`. A channel without a block and without a section is skipped. |
| `<channel>.link` | yes | The URL of the link card. LinkedIn shows it as an article card, Bluesky as an external embed. |
| `<channel>.title`, `.description`, `.image` | no | Override the page's `og:title`, `og:description`, `og:image`. The image must be PNG or JPEG under 1 MB. |
| `bluesky.lang` | no | BCP 47 language of the text, default `en`. |

The parser understands scalars, one level of nesting with two-space indentation, quoted strings and `#` comments. Nothing else. In double quotes, `\"` and `\\` are escapes; in single quotes, `''` is a literal `'`. Text after a closing quote other than a comment is an error. A `#` after whitespace starts a comment, so a value containing ` #` (`Folge #3`) must be quoted. A leading UTF-8 byte order mark is ignored.

## Sections

`## linkedin` and `## bluesky` headings, each followed by the text for that channel. Text is posted as is (line breaks included), after trimming.

- **LinkedIn**: up to 3000 characters after escaping. Put the link in the text as `https://...` as well as in `link`: the card is for the look, the text link because LinkedIn treats the two differently in reach. Characters that are markup in LinkedIn's "little" format (`\ | { } @ [ ] ( ) < > # * _ ~`) are escaped for you; `#Hashtags` stay hashtags.
- **Bluesky**: up to 300 graphemes (what a person sees as one character; `Intl.Segmenter` counts). Hashtags and links in the text become facets with correct UTF-8 byte offsets. Leave the URL out of the text, the card carries it; `validate` warns if both are present.

## Rules

`rules/forbidden.txt` in the content repo lists substrings that must not appear (one per line, `#` comments, case-insensitive). Em dash, en dash and `utm_` are always forbidden.

## Validation

`postkasten validate` checks every file:

- front matter schema and unknown keys
- `at` is a real calendar date (no Feb 30) with an explicit offset, and that offset matches the configured time zone at that instant
- LinkedIn length after escaping, Bluesky grapheme count, facets computable
- forbidden substrings in texts and `title`/`description` overrides, `utm_` in links
- links answer with 200 and have `og:title` (or a `title` override), card images are PNG/JPEG under 1 MB (skipped with `--offline`)
- publish-log lines whose file no longer exists, open intents
