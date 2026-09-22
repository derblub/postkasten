import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { parseState, openIntents, serializeEntry } from "../state.js";
import { readOptional } from "../validate.js";
import { context, log } from "./context.js";

export const usage = "resolve <file> <channel> --published <id> | --drop   close an open intent by hand";

export async function run(args) {
  const [file, channel] = args.positionals.slice(1);
  if (!file || !channel) throw new Error(usage);
  const { cwd, config } = await context();
  const statePath = join(cwd, config.stateFile);
  const state = parseState(await readOptional(statePath));
  const open = openIntents(state).find((i) => i.file === file && i.channel === channel);
  if (!open) throw new Error(`no open intent for ${file} ${channel}`);

  let entry;
  if (args.values.published !== undefined) {
    entry = { file, channel, status: "published", at: open.at, id: args.values.published || null, note: "resolved by hand" };
  } else if (args.values.drop) {
    entry = { file, channel, status: "resolved", at: open.at, note: "intent dropped by hand; post will be attempted again" };
  } else {
    throw new Error("pass --published <id> (it is on the platform) or --drop (it is not)");
  }
  await appendFile(statePath, serializeEntry({ ...entry, ts: new Date().toISOString() }));
  log(`wrote ${entry.status} line for ${file} ${channel}; commit and push ${config.stateFile}`);
}
