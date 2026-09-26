/**
 * A fetch double for dry runs: records every request to the platform APIs
 * (Authorization and secret body fields redacted, binary bodies summarised) and answers with the
 * minimum the clients need to continue. The recorded list is what `publish
 * --dry-run` prints, and what the tests snapshot.
 */
export function createRecordingFetch() {
  const requests = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    if (headers.authorization) headers.authorization = "Bearer ***";
    requests.push({ method: init.method ?? "GET", url, headers, body: describeBody(init.body) });
    return fakeResponse(url, init);
  };
  return { fetch: fetchImpl, requests };
}

const SECRET_KEYS = ["password", "client_secret", "access_token", "refresh_token", "token", "code"];

function redact(obj) {
  if (obj && typeof obj === "object") for (const k of SECRET_KEYS) if (k in obj) obj[k] = "***";
  return obj;
}

function describeBody(body) {
  if (body === undefined) return undefined;
  if (typeof body === "string") {
    try { return redact(JSON.parse(body)); } catch { return body; }
  }
  if (body instanceof URLSearchParams) return redact(Object.fromEntries(body));
  if (body?.byteLength !== undefined) return { bytes: body.byteLength };
  return String(body);
}

function fakeResponse(url, init) {
  const json = (obj, status = 200, headers = {}) =>
    new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });
  if (url.includes("/v2/userinfo")) return json({ sub: "DRYRUN", name: "Dry Run" });
  if (url.includes("/rest/images?action=initializeUpload")) {
    return json({ value: { uploadUrl: "https://dryrun.invalid/upload", image: "urn:li:image:DRYRUN" } });
  }
  if (url.startsWith("https://dryrun.invalid/upload")) return new Response("", { status: 201 });
  if (url.includes("/rest/posts")) {
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    return new Response("", { status: 201, headers: { "x-restli-id": "urn:li:share:DRYRUN" } });
  }
  if (url.includes("createSession")) return json({ did: "did:plc:dryrun", handle: "dryrun.invalid", accessJwt: "dry", refreshJwt: "dry" });
  if (url.includes("uploadBlob")) return json({ blob: { $type: "blob", ref: { $link: "bafydryrun" }, mimeType: "image/png", size: 1 } });
  if (url.includes("getAuthorFeed")) return json({ feed: [] });
  if (url.includes("createRecord")) return json({ uri: "at://did:plc:dryrun/app.bsky.feed.post/dryrun", cid: "bafydryrun" });
  if (url.includes("getRecord")) return json({ uri: "at://did:plc:dryrun/app.bsky.actor.profile/self", cid: "bafyprofile", value: { $type: "app.bsky.actor.profile", displayName: "Old" } });
  if (url.includes("putRecord")) return json({ uri: "at://did:plc:dryrun/app.bsky.actor.profile/self", cid: "bafyprofile2" });
  if (url.includes("introspectToken")) return json({ active: true, expires_at: Math.floor(Date.now() / 1000) + 30 * 86400, scope: "openid,profile,w_member_social" });
  return json({ error: `no dry-run answer for ${url}` }, 500);
}
