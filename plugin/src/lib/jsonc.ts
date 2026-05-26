// plugin/src/lib/jsonc.ts — Self-contained copy from shared/
/**
 * Strips comments from JSONC content while respecting string boundaries.
 * Handles // and /* comments, URLs in strings, and escaped quotes.
 * Also removes trailing commas to support more relaxed JSONC format.
 */
export function stripJsoncComments(content: string): string {
  let result = "";
  let i = 0;
  let inString = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;

  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (!inSingleLineComment && !inMultiLineComment) {
      if (char === '"') {
        // Count consecutive backslashes before this quote
        let backslashCount = 0;
        let j = i - 1;
        while (j >= 0 && content[j] === "\\") {
          backslashCount++;
          j--;
        }
        // Quote is escaped only if preceded by ODD number of backslashes
        // e.g., \" = escaped, \\" = not escaped (escaped backslash + quote)
        if (backslashCount % 2 === 0) {
          inString = !inString;
        }
        result += char;
        i++;
        continue;
      }
    }

    if (inString) {
      result += char;
      i++;
      continue;
    }

    if (!inSingleLineComment && !inMultiLineComment) {
      if (char === "/" && nextChar === "/") {
        inSingleLineComment = true;
        i += 2;
        continue;
      }

      if (char === "/" && nextChar === "*") {
        inMultiLineComment = true;
        i += 2;
        continue;
      }
    }

    if (inSingleLineComment) {
      if (char === "\n") {
        inSingleLineComment = false;
        result += char;
      }
      i++;
      continue;
    }

    if (inMultiLineComment) {
      if (char === "*" && nextChar === "/") {
        inMultiLineComment = false;
        i += 2;
        continue;
      }
      if (char === "\n") {
        result += char;
      }
      i++;
      continue;
    }

    result += char;
    i++;
  }

  // Remove trailing commas before } or ], respecting string boundaries
  return stripTrailingCommas(result);
}

function stripTrailingCommas(input: string): string {
  let result = "";
  let inString = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Handle string boundaries (quote preceded by even number of backslashes)
    if (ch === '"') {
      let backslashCount = 0;
      let j = i - 1;
      while (j >= 0 && result[j] === "\\") {
        backslashCount++;
        j--;
      }
      if (backslashCount % 2 === 0) {
        inString = !inString;
      }
      result += ch;
      i++;
      continue;
    }

    // Only consider trailing comma removal outside strings
    if (!inString && ch === ",") {
      // Look ahead: if the rest (after optional whitespace) starts with } or ], skip the comma
      const rest = input.slice(i + 1);
      const match = rest.match(/^(\s*[}\]])/);
      if (match) {
        // Skip the comma, keep the whitespace + closer
        result += match[1];
        i += 1 + match[0].length;
        continue;
      }
    }

    result += ch;
    i++;
  }

  return result;
}
