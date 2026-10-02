// Shared CSS scanning for `@apply` preserves UTF-16 offsets. Comments are
// blanked; quoted strings and bracketed groups are also blanked by default.
// Class scanning keeps brackets and quotes, filling non-whitespace quoted
// content with `x` so quoted text cannot impersonate a class token while a
// quoted whitespace still separates tokens the way Tailwind's scanner does.
export function maskNonCode(css, { maskBrackets = true } = {}) {
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
      const end = skipString(i);
      const stop = Math.min(end + 1, css.length);
      if (maskBrackets) blank(i, stop);
      else for (let j = i + 1; j < end; j += 1) if (!/\s/.test(css[j])) masked[j] = "x";
      i = stop - 1;
    } else if (ch === "[" && maskBrackets) {
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

// Each body runs to the next top-level `;`, `{` or `}` in the masked text.
// Token classification reads classBody, preserving brackets and masked quotes.
// Shorthand and important checks read maskedBody, which also blanks arbitrary
// values so their contents cannot impersonate those uses.
export function applyBodies(css) {
  const masked = maskNonCode(css);
  const classMasked = maskNonCode(css, { maskBrackets: false });
  const bodies = [];
  for (const match of masked.matchAll(APPLY)) {
    const start = match.index + match[0].length;
    let end = start;
    while (end < masked.length && !";{}".includes(masked[end])) end++;
    bodies.push({
      body: css.slice(start, end),
      classBody: classMasked.slice(start, end),
      maskedBody: masked.slice(start, end),
      start,
    });
  }
  return bodies;
}
