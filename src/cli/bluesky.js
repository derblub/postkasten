import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createBluesky, postUrl, rkeyOf } from "../bluesky/client.js";
import { buildRecord } from "../bluesky/embed.js";
import { mergeProfile, parseProfile } from "../bluesky/profile.js";
import { context, log, out } from "./context.js";

export const usage = [
  "bluesky profile [--file profile/bluesky.md] [--dry-run]   set display name and bio (avatar/banner untouched)",
  "bluesky test-post [--text T]       create a post, prints the URL",
  "bluesky delete <uri|rkey>          delete a post",
].join("\n  ");

export async function run(args) {
  const sub = args.positionals[1];
  const { cwd, config, creds } = await context();
  const client = createBluesky({ service: config.bskyService });
  const login = () => client.login(creds.bluesky.handle, creds.bluesky.appPassword);

  if (sub === "profile") {
    const file = args.values.file ?? config.profileFile;
    const profile = parseProfile(await readFile(join(cwd, file), "utf8"));
    if (args.values["dry-run"]) {
      out(JSON.stringify(profile, null, 2));
      return;
    }
    const { handle } = await login();
    const existing = await client.getProfileRecord();
    let avatarBlob;
    if (profile.avatar) {
      const bytes = await readFile(join(cwd, dirname(file), profile.avatar));
      const type = profile.avatar.endsWith(".png") ? "image/png" : "image/jpeg";
      avatarBlob = await client.uploadBlob(new Uint8Array(bytes), type);
    }
    await client.putProfileRecord(mergeProfile(existing?.value, { ...profile, avatarBlob }), existing?.cid);
    log(`profile of ${handle} updated: "${profile.displayName}", ${profile.description.length} chars bio`);
    return;
  }
  if (sub === "test-post") {
    const { handle } = await login();
    const text = args.values.text ?? "postkasten test with ä, € and 🚀 #Test. Delete me.";
    const { uri } = await client.createPost(buildRecord({ text, createdAt: new Date().toISOString() }));
    out(postUrl(uri, handle));
    log(`delete with: postkasten bluesky delete ${rkeyOf(uri)}`);
    return;
  }
  if (sub === "delete") {
    const target = args.positionals[2];
    if (!target) throw new Error("bluesky delete <uri|rkey>");
    await login();
    await client.deletePost(rkeyOf(target));
    log(`deleted ${target}`);
    return;
  }
  throw new Error(usage);
}
