import { escapeLittle, LINKEDIN_MAX_COMMENTARY } from "../text/linkedin-escape.js";

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 300;

/**
 * Body for `POST /rest/posts`: a member post with commentary and an article
 * card. `thumbnail` is an image URN from the Images API.
 */
export function buildPost({ authorUrn, text, link, title, description, thumbnail, visibility = "PUBLIC" }) {
  const commentary = escapeLittle(text);
  if (commentary.length > LINKEDIN_MAX_COMMENTARY) {
    throw new Error(`LinkedIn commentary is ${commentary.length} characters after escaping, limit is ${LINKEDIN_MAX_COMMENTARY}`);
  }
  const post = {
    author: authorUrn,
    commentary,
    visibility,
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (link) {
    const article = { source: link, title: clip(title ?? link, TITLE_MAX) };
    if (description) article.description = clip(description, DESCRIPTION_MAX);
    if (thumbnail) article.thumbnail = thumbnail;
    post.content = { article };
  }
  return post;
}

function clip(text, max) {
  const s = String(text).trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}
