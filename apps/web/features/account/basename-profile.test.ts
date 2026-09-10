import { describe, expect, test } from "bun:test";
import {
  basenameProfileUrl,
  fetchBasenameProfile,
  parseBasenameProfile,
  profileGlyph,
} from "./basename-profile";

const ADDRESS = "0x1111111111111111111111111111111111111111";

describe("profileGlyph", () => {
  test("prefers Basename, then email local-part, then owner key", () => {
    expect(
      profileGlyph({
        basename: "Jesse.base.eth",
        ownerKey: "ada@example.test",
        address: ADDRESS,
      }),
    ).toBe("j");
    expect(profileGlyph({ ownerKey: "Ada@example.test" })).toBe("a");
    expect(profileGlyph({ ownerKey: "home-user" })).toBe("h");
    expect(profileGlyph({ address: ADDRESS })).toBe("1");
    expect(profileGlyph({})).toBe("");
  });
});

describe("parseBasenameProfile", () => {
  test("reads name and https avatar and ignores junk", () => {
    expect(
      parseBasenameProfile({
        name: "jesse.base.eth",
        avatar: "https://example.test/j.png",
      }),
    ).toEqual({
      name: "jesse.base.eth",
      avatarUrl: "https://example.test/j.png",
    });
    expect(
      parseBasenameProfile({
        ens: "jesse.base.eth",
        ens_avatar: "http://example.test/j.png",
      }),
    ).toEqual({
      name: "jesse.base.eth",
      avatarUrl: "http://example.test/j.png",
    });
    expect(parseBasenameProfile({ avatar: "javascript:alert(1)" })).toBeNull();
    expect(parseBasenameProfile({ name: "" })).toBeNull();
    expect(parseBasenameProfile(null)).toBeNull();
  });
});

describe("fetchBasenameProfile", () => {
  test("fail-opens on bad address, HTTP error, or thrown fetch", async () => {
    expect(await fetchBasenameProfile("not-an-address")).toBeNull();
    expect(
      await fetchBasenameProfile(ADDRESS, async () => new Response("no", { status: 503 })),
    ).toBeNull();
    expect(
      await fetchBasenameProfile(ADDRESS, async () => {
        throw new Error("offline");
      }),
    ).toBeNull();
  });

  test("returns a parsed profile from the public resolver URL", async () => {
    const seen: string[] = [];
    const profile = await fetchBasenameProfile(ADDRESS, async (input) => {
      seen.push(String(input));
      return Response.json({
        name: "jesse.base.eth",
        avatar: "https://example.test/j.png",
      });
    });
    expect(seen).toEqual([basenameProfileUrl(ADDRESS)]);
    expect(profile).toEqual({
      name: "jesse.base.eth",
      avatarUrl: "https://example.test/j.png",
    });
  });
});
