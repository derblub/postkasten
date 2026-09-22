import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { ApiError, shortBody } from "../errors.js";

export const SCOPES = ["openid", "profile", "w_member_social"];
export const DEFAULT_REDIRECT = "http://localhost:8787/callback";

export function authorizationUrl({ clientId, redirectUri = DEFAULT_REDIRECT, state, scopes = SCOPES }) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: scopes.join(" "),
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
}

export async function exchangeCode({ code, clientId, clientSecret, redirectUri = DEFAULT_REDIRECT, fetch: fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new ApiError("LinkedIn", res.status, shortBody(text), "accessToken");
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error("LinkedIn token response has no access_token");
  return {
    accessToken: json.access_token,
    expiresIn: json.expires_in,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
    scope: json.scope,
  };
}

/**
 * Runs the 3-legged flow with a one-shot local callback server. Returns the
 * authorization code once the browser lands on the redirect URI.
 */
export function waitForCode({ redirectUri = DEFAULT_REDIRECT, state, timeoutMs = 5 * 60_000 }) {
  const { port, pathname } = new URL(redirectUri);
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== pathname) {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const gotState = url.searchParams.get("state");
      res.setHeader("content-type", "text/html; charset=utf-8");
      if (error || !code || gotState !== state) {
        res.writeHead(400).end(`<p>Login failed: ${error || "missing code or state mismatch"}. You can close this tab.</p>`);
        finish(new Error(error || "missing code or state mismatch"));
        return;
      }
      res.writeHead(200).end("<p>postkasten has the token. You can close this tab.</p>");
      finish(null, code);
    });
    const timer = setTimeout(() => finish(new Error("timed out waiting for the browser")), timeoutMs);
    function finish(err, code) {
      clearTimeout(timer);
      server.close();
      err ? reject(err) : resolve(code);
    }
    server.on("error", (err) => finish(err));
    server.listen(Number(port) || 80, "127.0.0.1");
  });
}

export function randomState() {
  return randomBytes(16).toString("hex");
}
