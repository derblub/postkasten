/**
 * The publish log: one JSON line per event in `state/published.jsonl`,
 * committed to the content repo. Git is the single source of truth for what
 * has been posted (LinkedIn does not let an app read its own posts back).
 *
 * Statuses:
 *   intent     written and pushed right before a publish attempt
 *   published  the post exists on the platform (id/url when known)
 *   failed     an attempt failed; bound to `at`, three of them give up
 *   skipped    overdue beyond the due window; bound to `at`
 *
 * A `published` line ends the (file, channel) for good, whatever `at` says
 * later. `failed`/`skipped` carry `at`, so re-dating a post re-arms it.
 */

export const MAX_FAILURES = 3;

export function parseState(content) {
  const entries = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    try {
      entries.push(JSON.parse(line));
    } catch {
      throw new Error(`state file line ${i + 1} is not valid JSON`);
    }
  });
  return entries;
}

export function serializeEntry(entry) {
  return JSON.stringify(entry) + "\n";
}

function forKey(entries, file, channel) {
  return entries.filter((e) => e.file === file && e.channel === channel);
}

/**
 * Derives what should happen for a (file, channel) at a given `at`.
 * @returns {{ status: 'published'|'blocked'|'given_up'|'skipped'|'pending', entry?: object, failures: number }}
 */
export function resolveStatus(entries, file, channel, at) {
  const own = forKey(entries, file, channel);
  const published = own.find((e) => e.status === "published");
  if (published) return { status: "published", entry: published, failures: 0 };

  // An intent is open when no failed/resolved line follows it in the file
  // (append order, like openIntents; `ts` comes from different clocks).
  const lastIntent = own.findLastIndex((e) => e.status === "intent");
  if (lastIntent !== -1 && !own.slice(lastIntent + 1).some((e) => e.status === "failed" || e.status === "resolved")) {
    return { status: "blocked", entry: own[lastIntent], failures: 0 };
  }

  const failures = own.filter((e) => e.status === "failed" && e.at === at).length;
  if (failures >= MAX_FAILURES) return { status: "given_up", failures };

  const skipped = own.find((e) => e.status === "skipped" && e.at === at);
  if (skipped) return { status: "skipped", entry: skipped, failures };

  return { status: "pending", failures };
}

/** State lines whose file no longer exists in the queue. */
export function orphanedEntries(entries, files) {
  const known = new Set(files);
  return entries.filter((e) => !known.has(e.file));
}

export function openIntents(entries) {
  const keys = new Map();
  for (const e of entries) {
    const k = `${e.file}\u0000${e.channel}`;
    if (e.status === "intent") keys.set(k, e);
    else if (["published", "failed", "resolved"].includes(e.status)) keys.delete(k);
  }
  return [...keys.values()];
}
