/**
 * Minimal front matter parser: a `---` fenced block of simple YAML at the top
 * of a Markdown file. Supports `key: value` scalars, one level of nesting via
 * two-space indentation, quoted strings, `#` comments and blank lines. That is
 * all a post file needs; anything fancier is a validation error, not a feature.
 */

export class FrontmatterError extends Error {
  constructor(message, line) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = "FrontmatterError";
    this.line = line;
  }
}

const KEY = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/;

function unquote(raw) {
  const value = raw.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    if (end !== -1) return value.slice(1, end);
  }
  // Strip a trailing comment on an unquoted value ("value  # note").
  const hash = value.search(/\s#/);
  return (hash === -1 ? value : value.slice(0, hash)).trim();
}

/**
 * @param {string} source  The whole file.
 * @returns {{ data: Record<string, string | Record<string, string>>, body: string, bodyLine: number }}
 */
export function parseFrontmatter(source) {
  const lines = source.split(/\r?\n/);
  if (lines[0] !== "---") {
    throw new FrontmatterError("file must start with a `---` front matter block", 1);
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    throw new FrontmatterError("front matter block is never closed with `---`");
  }

  const data = {};
  let parent = null;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const indented = /^ {2}\S/.test(line);
    if (indented) {
      if (!parent) throw new FrontmatterError("indented value without a parent key", lineNo);
      const m = KEY.exec(line.trim());
      if (!m) throw new FrontmatterError(`cannot parse \`${line.trim()}\``, lineNo);
      if (m[2] === undefined) throw new FrontmatterError(`nested key \`${m[1]}\` needs a value`, lineNo);
      data[parent][m[1]] = unquote(m[2]);
      continue;
    }
    if (/^\s/.test(line)) {
      throw new FrontmatterError("indentation must be exactly two spaces", lineNo);
    }
    const m = KEY.exec(line);
    if (!m) throw new FrontmatterError(`cannot parse \`${line}\``, lineNo);
    const [, key, rawValue] = m;
    if (rawValue === undefined || rawValue.trim() === "" || rawValue.trim().startsWith("#")) {
      data[key] = {};
      parent = key;
    } else {
      data[key] = unquote(rawValue);
      parent = null;
    }
  }

  return { data, body: lines.slice(end + 1).join("\n"), bodyLine: end + 2 };
}
