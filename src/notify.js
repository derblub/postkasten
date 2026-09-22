/**
 * ntfy.sh notifications. Without a topic every call is a no-op, so local runs
 * stay quiet. One HTTP call, no shell script.
 */
export function createNotifier({ topic, server = "https://ntfy.sh", fetch: fetchImpl = globalThis.fetch, log = () => {} } = {}) {
  return async function notify({ title, message, priority = "default", tags = [], click } = {}) {
    if (!topic) return false;
    const headers = { title, priority, tags: tags.join(","), markdown: "no" };
    if (click) headers.click = click;
    try {
      const res = await fetchImpl(`${server.replace(/\/$/, "")}/${topic}`, { method: "POST", headers, body: message });
      if (!res.ok) log(`ntfy answered ${res.status}`);
      return res.ok;
    } catch (err) {
      log(`ntfy failed: ${err.message}`);
      return false;
    }
  };
}
