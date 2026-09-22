import { execFile } from "node:child_process";
import { authorizationUrl, exchangeCode, randomState, waitForCode, DEFAULT_REDIRECT } from "../linkedin/auth.js";
import { createLinkedIn, postUrl } from "../linkedin/client.js";
import { buildPost } from "../linkedin/posts.js";
import { context, log, out } from "./context.js";

export const usage = [
  "linkedin auth [--redirect URL]     browser login, prints a 60-day token",
  "linkedin test-post [--text T]      post to CONNECTIONS only, prints the URN (verify escaping, then delete)",
  "linkedin delete <urn>              delete a post",
].join("\n  ");

export async function run(args) {
  const sub = args.positionals[1];
  const { config, creds } = await context();
  if (sub === "auth") return auth(args, creds);
  if (sub === "test-post") return testPost(args, config, creds);
  if (sub === "delete") return del(args, config, creds);
  throw new Error(usage);
}

async function auth(args, creds) {
  const { clientId, clientSecret } = creds.linkedin;
  if (!clientId || !clientSecret) throw new Error("set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET (from the app's Auth tab)");
  const redirectUri = args.values.redirect ?? DEFAULT_REDIRECT;
  const state = randomState();
  const url = authorizationUrl({ clientId, redirectUri, state });
  log(`Open this URL in your browser (redirect URI must be registered in the app):\n\n${url}\n`);
  execFile("xdg-open", [url], () => {});
  const code = await waitForCode({ redirectUri, state });
  const token = await exchangeCode({ code, clientId, clientSecret, redirectUri });
  const expires = token.expiresAt.toISOString().slice(0, 10);
  log(`Token received, scope "${token.scope}", valid until ${expires}.\n`);
  log("Store it in CI (GitLab):\n");
  out(`glab variable set LINKEDIN_ACCESS_TOKEN --masked --protected --value '${token.accessToken}'`);
  log("\nOr export it locally:\n");
  out(`export LINKEDIN_ACCESS_TOKEN='${token.accessToken}'`);
  log(`\nPut a reminder in your calendar for ${expires}.`);
}

async function testPost(args, config, creds) {
  const li = createLinkedIn({ token: creds.linkedin.token, version: creds.linkedin.version ?? config.linkedinVersion });
  const { personUrn } = await li.userinfo();
  const text = args.values.text ?? "postkasten test: #Hashtag stays, (parentheses) and a_b_c and 100% stay literal. Delete me.";
  const body = buildPost({ authorUrn: personUrn, text, visibility: "CONNECTIONS" });
  const urn = await li.createPost(body);
  out(urn ?? "(no urn returned)");
  log(`posted to connections only: ${postUrl(urn) ?? "?"}\nCheck the rendering, then: postkasten linkedin delete ${urn}`);
}

async function del(args, config, creds) {
  const urn = args.positionals[2];
  if (!urn) throw new Error("linkedin delete <urn>");
  const li = createLinkedIn({ token: creds.linkedin.token, version: creds.linkedin.version ?? config.linkedinVersion });
  await li.deletePost(urn);
  log(`deleted ${urn}`);
}
