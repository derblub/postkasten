/**
 * Time handling. A post's `at` must carry an explicit UTC offset so that
 * `Date.parse` is unambiguous and due-checks are plain millisecond
 * comparisons. `validate` additionally checks the written offset against the
 * configured time zone at that instant, which catches "+02:00" written in
 * January.
 */

const AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * @param {string} value
 * @returns {{ ms: number, offset: string }}
 */
export function parseAt(value) {
  const m = AT.exec(String(value ?? "").trim());
  if (!m) {
    throw new Error(
      `\`at\` must look like 2026-09-29T08:30:00+02:00 (explicit offset), got \`${value}\``,
    );
  }
  const ms = Date.parse(m[0]);
  if (Number.isNaN(ms)) throw new Error(`\`at\` is not a valid date: \`${value}\``);
  return { ms, offset: m[7] === "Z" ? "+00:00" : m[7] };
}

/**
 * The UTC offset a time zone has at a given instant, as "+02:00".
 * @param {number} ms
 * @param {string} timeZone  IANA name, e.g. "Europe/Vienna".
 */
export function offsetAt(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(ms));
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  // "GMT" for zero, "GMT+02:00" or "GMT+5:30" otherwise.
  const m = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(name);
  if (!m || !m[1]) return "+00:00";
  return `${m[1]}${m[2].padStart(2, "0")}:${m[3] ?? "00"}`;
}

/**
 * Formats an instant in the configured zone, e.g. "Tue 2026-09-29 08:30".
 */
export function formatLocal(ms, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function isDue(atMs, nowMs) {
  return atMs <= nowMs;
}

export function overdueHours(atMs, nowMs) {
  return (nowMs - atMs) / 3_600_000;
}
