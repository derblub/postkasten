import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
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
    const profilePath = resolve(cwd, file);
    const profile = parseProfile(await readFile(profilePath, "utf8"));
    const avatarType = profile.avatar ? imageType(profile.avatar) : undefined;
    if (args.values["dry-run"]) {
      out(JSON.stringify(profile, null, 2));
      return;
    }
    const { handle } = await login();
    const existing = await client.getProfileRecord();
    let avatarBlob;
    if (profile.avatar) {
      const bytes = await readFile(resolve(dirname(profilePath), profile.avatar));
      avatarBlob = await client.uploadBlob(new Uint8Array(bytes), avatarType);
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

/** MIME type of a profile avatar; Bluesky takes PNG and JPEG only. */
export function imageType(file) {
  const ext = file.toLowerCase().match(/\.(png|jpe?g)$/)?.[1];
  if (!ext) throw new Error(`avatar must be a .png, .jpg or .jpeg file, got ${file}`);
  return ext === "png" ? "image/png" : "image/jpeg";
}
