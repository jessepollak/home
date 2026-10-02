import { describe, expect, test } from "bun:test";
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  INVITE_LINK_CONTRACT_VERSION,
  invitePath,
  isInviteCode,
  parseInviteLinkResponse,
} from "./contract";

const code = "abcdefghjk";
const generatedCode = Array.from(
  { length: INVITE_CODE_LENGTH },
  (_, index) => INVITE_CODE_ALPHABET[(index * 7) % INVITE_CODE_ALPHABET.length],
).join("");
const nonStrings = [undefined, null, 1, true, {}, []];
const excludedCharacters = ["i", "l", "o", "0", "1", "A", "Z", "!", "-", " ", "é", "😀"];
const invalidCharacterCodes = excludedCharacters.map(
  (character) => "a".repeat(INVITE_CODE_LENGTH - character.length) + character,
);

describe("invite link contract", () => {
  test("round-trips exactly the versioned response", () => {
    expect(INVITE_LINK_CONTRACT_VERSION).toBe(1);
    const response = { version: INVITE_LINK_CONTRACT_VERSION, code };
    expect(parseInviteLinkResponse(response)).toEqual(response);
  });

  test("accepts a code generated from the exported alphabet", () => {
    expect(generatedCode).toHaveLength(10);
    expect(parseInviteLinkResponse({ version: 1, code: generatedCode }))
      .toEqual({ version: 1, code: generatedCode });
  });

  test("rejects unsupported, incorrectly typed, or missing versions", () => {
    for (const version of [2, "1", undefined]) {
      expect(parseInviteLinkResponse({ version, code })).toBeNull();
    }
    expect(parseInviteLinkResponse({ code })).toBeNull();
  });

  test("rejects missing and non-string codes", () => {
    expect(parseInviteLinkResponse({ version: 1 })).toBeNull();
    for (const value of nonStrings) {
      expect(parseInviteLinkResponse({ version: 1, code: value })).toBeNull();
    }
  });

  test("rejects short and long codes", () => {
    for (const value of [code.slice(1), code + "a"]) {
      expect(parseInviteLinkResponse({ version: 1, code: value })).toBeNull();
    }
  });

  test("rejects excluded characters even at the required string length", () => {
    for (const value of invalidCharacterCodes) {
      expect(value).toHaveLength(10);
      expect(parseInviteLinkResponse({ version: 1, code: value })).toBeNull();
    }
  });

  test("rejects non-object responses", () => {
    for (const value of [null, undefined, [], "x", 1, true]) {
      expect(parseInviteLinkResponse(value)).toBeNull();
    }
  });

  test("rejects extra private fields rather than passing them through", () => {
    expect(parseInviteLinkResponse({ version: 1, code, customerId: "cus_private" })).toBeNull();
    expect(parseInviteLinkResponse({ version: 1, code, owner: "private" })).toBeNull();
  });
});

describe("invite codes", () => {
  test("accepts the valid code, generated code, and every alphabet character", () => {
    expect(isInviteCode(code)).toBe(true);
    expect(isInviteCode(generatedCode)).toBe(true);
    for (const character of INVITE_CODE_ALPHABET) {
      expect(isInviteCode(character.repeat(INVITE_CODE_LENGTH))).toBe(true);
    }
  });

  test("rejects non-strings and lengths outside the exact boundary", () => {
    for (const value of [...nonStrings, "", code.slice(1), code + "a"]) {
      expect(isInviteCode(value)).toBe(false);
    }
  });

  test("rejects characters outside the alphabet", () => {
    for (const value of invalidCharacterCodes) {
      expect(isInviteCode(value)).toBe(false);
    }
  });

  test("constructs the invitation path", () => {
    expect(invitePath(code)).toBe(`/invite/${code}`);
  });
});
