export class ApiError extends Error {
  constructor(service, status, detail, request) {
    super(`${service} ${request ? request + " " : ""}returned ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "ApiError";
    this.service = service;
    this.status = status;
    this.detail = detail;
  }
}

/** Shortens an error body for logs and state lines; never more than one line. */
export function shortBody(text, max = 300) {
  const oneLine = String(text ?? "").replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}
