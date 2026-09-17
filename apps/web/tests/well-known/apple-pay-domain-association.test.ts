import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const associationPath = resolve(
  import.meta.dir,
  "../../public/.well-known/apple-developer-merchantid-domain-association",
);

describe("apple pay domain association file", () => {
  test("is byte-for-byte the provider-supplied association", async () => {
    const bytes = await readFile(associationPath);
    expect(bytes.byteLength).toBe(5_784);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "51e5be88b2e5372fff6fd5c82fc53a7ef6737e7d6628dae168f2eba8c8e24afb",
    );
  });
});
