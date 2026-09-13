import "server-only";

export function parseJsonWithNumberLexemes(text: string): unknown {
  let transformed = "";
  let index = 0;

  while (index < text.length) {
    const character = text[index];

    if (character === '"') {
      const stringStart = index;
      index += 1;
      while (index < text.length) {
        if (text[index] === "\\") {
          index += 2;
          continue;
        }
        if (text[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      transformed += text.slice(stringStart, index);
      continue;
    }

    if (character === "-" || isDigit(character)) {
      const numberStart = index;
      if (text[index] === "-") index += 1;
      while (isDigit(text[index])) index += 1;
      if (text[index] === ".") {
        index += 1;
        while (isDigit(text[index])) index += 1;
      }
      if (text[index] === "e" || text[index] === "E") {
        index += 1;
        if (text[index] === "+" || text[index] === "-") index += 1;
        while (isDigit(text[index])) index += 1;
      }

      const token = text.slice(numberStart, index);
      transformed += JSON.stringify(token);
      continue;
    }

    transformed += character;
    index += 1;
  }

  return JSON.parse(transformed) as unknown;
}

function isDigit(value: string | undefined) {
  return value !== undefined && value >= "0" && value <= "9";
}
