import { ApiError, shortBody } from "../errors.js";

export const LINKEDIN_API = "https://api.linkedin.com";
const TIMEOUT_MS = 30_000;

/**
 * LinkedIn REST client for one member token. `fetch` is injected so tests and
 * dry runs can replace it; the token is never logged.
 */
export function createLinkedIn({ fetch: fetchImpl = globalThis.fetch, token, version, base = LINKEDIN_API }) {
  if (!token) throw new Error("LinkedIn access token is missing (LINKEDIN_ACCESS_TOKEN)");
  if (!/^\d{6}$/.test(String(version))) throw new Error(`LinkedIn-Version must be YYYYMM, got ${version}`);

  async function request(method, path, { body, headers = {}, raw = false } = {}) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "linkedin-version": String(version),
        "x-restli-protocol-version": "2.0.0",
        ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new ApiError("LinkedIn", res.status, shortBody(text), `${method} ${path}`);
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch { json = null; }
    }
    return { status: res.status, headers: res.headers, json, text };
  }

  return {
    /** OpenID Connect userinfo; `sub` is the member id behind `urn:li:person:{sub}`. */
    async userinfo() {
      const { json } = await request("GET", "/v2/userinfo");
      if (!json?.sub) throw new Error("LinkedIn userinfo has no `sub`");
      return { ...json, personUrn: `urn:li:person:${json.sub}` };
    },

    /** Images API: register an upload, PUT the bytes, return the image URN. */
    async uploadImage(ownerUrn, bytes, contentType) {
      const { json } = await request("POST", "/rest/images?action=initializeUpload", {
        body: { initializeUploadRequest: { owner: ownerUrn } },
      });
      const uploadUrl = json?.value?.uploadUrl;
      const image = json?.value?.image;
      if (!uploadUrl || !image) throw new Error("LinkedIn initializeUpload returned no uploadUrl/image");
      const put = await fetchImpl(uploadUrl, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": contentType },
        body: bytes,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!put.ok) throw new ApiError("LinkedIn", put.status, shortBody(await put.text()), "PUT image");
      return image;
    },

    /** Creates a post; returns the URN from `x-restli-id` (or null when the header is missing). */
    async createPost(post) {
      const { headers } = await request("POST", "/rest/posts", { body: post });
      return headers.get("x-restli-id") || null;
    },

    async deletePost(urn) {
      await request("DELETE", `/rest/posts/${encodeURIComponent(urn)}`, { headers: { "x-restli-method": "DELETE" } });
    },
  };
}

/**
 * Token introspection (client credentials plus the token). Returns
 * `{ active, expires_at (unix seconds), scope, ... }`.
 */
export async function introspectToken({ clientId, clientSecret, token, fetch: fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl("https://www.linkedin.com/oauth/v2/introspectToken", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, token }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new ApiError("LinkedIn", res.status, shortBody(text), "introspectToken");
  return JSON.parse(text);
}

export function postUrl(urn) {
  return urn ? `https://www.linkedin.com/feed/update/${urn}/` : null;
}
