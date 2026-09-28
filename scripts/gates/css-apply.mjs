// Shared CSS scanning for `@apply`: comments, quoted strings and bracketed
// arbitrary values are blanked in place, preserving UTF-16 length so an offset in
// the masked text still points at the same character of the original. Masking is
// what keeps a `}` inside `content-['}']`, a `[` inside a quoted value, and an
// escaped `\[` from being read as a delimiter.
export function maskNonCode(css) {
  const masked = css.split("");
  const blank = (from, to) => {
    for (let i = from; i < to && i < masked.length; i++) {
      if (masked[i] !== "\n") masked[i] = " ";
    }
  };
  const skipString = (from) => {
    const quote = css[from];
    let j = from + 1;
    for (; j < css.length; j++) {
      if (css[j] === "\\") {
        j++;
        continue;
      }
      if (css[j] === quote) return j;
    }
    return css.length;
  };
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "\\") {
      i++;
    } else if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end < 0 ? css.length : end + 2;
      blank(i, stop);
      i = stop - 1;
    } else if (ch === '"' || ch === "'") {
      const stop = Math.min(skipString(i) + 1, css.length);
      blank(i, stop);
      i = stop - 1;
    } else if (ch === "[") {
      let depth = 0;
      let j = i;
      for (; j < css.length; j++) {
        const inner = css[j];
        if (inner === "\\") {
          j++;
        } else if (inner === '"' || inner === "'") {
          j = skipString(j);
        } else if (inner === "[") {
          depth++;
        } else if (inner === "]") {
          depth--;
          if (depth === 0) break;
        }
      }
      const stop = Math.min(j + 1, css.length);
      blank(i, stop);
      i = stop - 1;
    }
  }
  return masked.join("");
}

const APPLY = /@apply\s+/g;

// Each body runs to the next top-level `;`, `{` or `}` in the masked text. The
// original text keeps bracket contents for callers that need them; the masked body
// is what token classification must read, so a commented-out token stays silent.
export function applyBodies(css) {
  const masked = maskNonCode(css);
  const bodies = [];
  for (const match of masked.matchAll(APPLY)) {
    const start = match.index + match[0].length;
    let end = start;
    while (end < masked.length && !";{}".includes(masked[end])) end++;
    bodies.push({ body: css.slice(start, end), maskedBody: masked.slice(start, end), start });
  }
  return bodies;
}
