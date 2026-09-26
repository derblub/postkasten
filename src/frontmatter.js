/**
 * Minimal front matter parser: a `---` fenced block of simple YAML at the top
 * of a Markdown file. Supports `key: value` scalars, one level of nesting via
 * two-space indentation, quoted strings (`\"`, `\\` and `''` escapes), `#`
 * comments and blank lines. That is all a post file needs; anything fancier
 * is a validation error, not a feature.
 */

export class FrontmatterError extends Error {
  constructor(message, line) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = "FrontmatterError";
    this.line = line;
  }
}

const KEY = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/;

function unquote(raw, lineNo) {
  const value = raw.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    let out = "";
    let i = 1;
    for (; i < value.length; i++) {
      const c = value[i];
      // `\"` and `\\` in double quotes (any other backslash is literal), `''` in single quotes.
      if (quote === '"' && c === "\\" && (value[i + 1] === '"' || value[i + 1] === "\\")) {
        out += value[++i];
        continue;
      }
      if (c === quote) {
        if (quote === "'" && value[i + 1] === "'") {
          out += "'";
          i++;
          continue;
        }
        break;
      }
      out += c;
    }
    if (i >= value.length) throw new FrontmatterError("unterminated quoted value", lineNo);
    const rest = value.slice(i + 1);
    if (rest.trim() && !/^\s+#/.test(rest)) throw new FrontmatterError("unexpected text after quoted value", lineNo);
    return out;
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
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
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
      data[parent][m[1]] = unquote(m[2], lineNo);
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
      data[key] = unquote(rawValue, lineNo);
      parent = null;
    }
  }

  return { data, body: lines.slice(end + 1).join("\n"), bodyLine: end + 2 };
}
