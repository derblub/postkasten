import { parseFrontmatter } from "../frontmatter.js";
import { countGraphemes } from "../text/graphemes.js";

export const DISPLAY_NAME_MAX = 64;
export const DESCRIPTION_MAX = 256;

/**
 * `profile/bluesky.md`: front matter with `displayName` (and optionally
 * `avatar`, a local image path), body is the bio.
 */
export function parseProfile(source) {
  const { data, body } = parseFrontmatter(source);
  const displayName = String(data.displayName ?? "").trim();
  const description = body.trim();
  if (!displayName) throw new Error("`displayName` is missing");
  if (countGraphemes(displayName) > DISPLAY_NAME_MAX) throw new Error(`displayName is longer than ${DISPLAY_NAME_MAX} graphemes`);
  if (countGraphemes(description) > DESCRIPTION_MAX) throw new Error(`bio is ${countGraphemes(description)} graphemes, limit is ${DESCRIPTION_MAX}`);
  return { displayName, description, avatar: data.avatar ? String(data.avatar) : undefined };
}

/** Merges the new texts into the existing record so avatar and banner survive. */
export function mergeProfile(existing, { displayName, description, avatarBlob }) {
  return {
    ...(existing ?? {}),
    $type: "app.bsky.actor.profile",
    displayName,
    description,
    ...(avatarBlob ? { avatar: avatarBlob } : {}),
  };
}
