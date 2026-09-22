import { ApiError, shortBody } from "../errors.js";

/**
 * AT Protocol client for one account, authenticated with an app password.
 * Only the handful of XRPC methods the publisher needs.
 */
export function createBluesky({ fetch: fetchImpl = globalThis.fetch, service = "https://bsky.social" }) {
  const base = service.replace(/\/$/, "");
  let session = null;

  async function xrpc(method, nsid, { params, body, contentType = "application/json", auth = true } = {}) {
    const query = params ? "?" + new URLSearchParams(params) : "";
    const res = await fetchImpl(`${base}/xrpc/${nsid}${query}`, {
      method,
      headers: {
        ...(auth && session ? { authorization: `Bearer ${session.accessJwt}` } : {}),
        ...(body !== undefined ? { "content-type": contentType } : {}),
      },
      body: body === undefined ? undefined : contentType === "application/json" ? JSON.stringify(body) : body,
    });
    const text = await res.text();
    if (!res.ok) throw new ApiError("Bluesky", res.status, shortBody(text), nsid);
    return text ? JSON.parse(text) : {};
  }

  return {
    async login(identifier, password) {
      if (!identifier || !password) throw new Error("Bluesky handle or app password is missing (BLUESKY_HANDLE, BLUESKY_APP_PASSWORD)");
      session = await xrpc("POST", "com.atproto.server.createSession", { body: { identifier, password }, auth: false });
      return { did: session.did, handle: session.handle };
    },
    get session() {
      return session;
    },
    async uploadBlob(bytes, contentType) {
      const { blob } = await xrpc("POST", "com.atproto.repo.uploadBlob", { body: bytes, contentType });
      return blob;
    },
    async createPost(record) {
      return xrpc("POST", "com.atproto.repo.createRecord", {
        body: { repo: session.did, collection: "app.bsky.feed.post", record },
      });
    },
    async deletePost(rkey) {
      return xrpc("POST", "com.atproto.repo.deleteRecord", {
        body: { repo: session.did, collection: "app.bsky.feed.post", rkey },
      });
    },
    async recentPosts(limit = 50) {
      const { feed = [] } = await xrpc("GET", "app.bsky.feed.getAuthorFeed", {
        params: { actor: session.did, limit: String(limit), filter: "posts_no_replies" },
      });
      return feed.map((item) => item.post).filter((p) => p?.author?.did === session.did);
    },
    async getProfileRecord() {
      try {
        return await xrpc("GET", "com.atproto.repo.getRecord", {
          params: { repo: session.did, collection: "app.bsky.actor.profile", rkey: "self" },
        });
      } catch (err) {
        if (err.status === 400) return null;
        throw err;
      }
    },
    async putProfileRecord(record, swapRecord) {
      return xrpc("POST", "com.atproto.repo.putRecord", {
        body: { repo: session.did, collection: "app.bsky.actor.profile", rkey: "self", record, ...(swapRecord ? { swapRecord } : {}) },
      });
    },
  };
}

/** at://did/app.bsky.feed.post/rkey  ->  https://bsky.app/profile/<handle>/post/<rkey> */
export function postUrl(uri, handle) {
  const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(uri ?? "");
  if (!m) return null;
  return `https://bsky.app/profile/${handle || m[1]}/post/${m[2]}`;
}

export function rkeyOf(uri) {
  return /\/([^/]+)$/.exec(uri ?? "")?.[1] ?? null;
}
