import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  boolArg,
  formatViewport,
  numberArg,
  parseArgs,
  parseBox,
  parseBoxList,
  parseViewport,
  roundPercent,
  stringArg,
} from "../scripts/lib/cli.mjs";

describe("parseArgs", () => {
  test("reads --key value and --key=value", () => {
    const args = parseArgs(["--ref", "a.png", "--target=2", "positional"]);
    assert.equal(args.ref, "a.png");
    assert.equal(args.target, "2");
    assert.deepEqual(args._, ["positional"]);
  });

  test("a bare flag with nothing after it is true, and it consumes a following bare token", () => {
    assert.equal(parseArgs(["--json"]).json, true);
    // `--json positional` means json="positional"; only a leading `--` starts a new flag.
    assert.equal(parseArgs(["--json", "positional"]).json, "positional");
  });

  test("collects repeatable keys into arrays", () => {
    const args = parseArgs(["--mask", "0,0,4,4", "--mask", "5,5,2,2"], { repeatable: ["mask"] });
    assert.deepEqual(args.mask, ["0,0,4,4", "5,5,2,2"]);
  });

  test("a repeatable key is still an array when given once", () => {
    const args = parseArgs(["--ls", "theme=dark"], { repeatable: ["ls"] });
    assert.deepEqual(args.ls, ["theme=dark"]);
  });

  test("a bare repeatable flag collects boolean true", () => {
    const args = parseArgs(["--hover"], { repeatable: ["hover"] });
    assert.deepEqual(args.hover, [true]);
  });

  test("does not swallow a following flag as a value", () => {
    const args = parseArgs(["--spec", "--target", "1"]);
    assert.equal(args.spec, true);
    assert.equal(args.target, "1");
  });

  test("rejects an empty key", () => {
    assert.throws(() => parseArgs(["--=nope"]), /Invalid flag/);
  });
});

describe("typed accessors", () => {
  test("stringArg only returns strings", () => {
    const args = parseArgs(["--a", "1", "--b"]);
    assert.equal(stringArg(args, "a"), "1");
    assert.equal(stringArg(args, "b"), undefined);
    assert.equal(stringArg(args, "missing"), undefined);
  });

  test("numberArg validates numbers", () => {
    const args = parseArgs(["--target", "2.5", "--bad", "abc"]);
    assert.equal(numberArg(args, "target"), 2.5);
    assert.equal(numberArg(args, "missing"), undefined);
    assert.throws(() => numberArg(args, "bad"), /expects a number/);
  });

  test("boolArg treats bare flags and true/1 as true", () => {
    const args = parseArgs(["--x", "--y", "1", "--z", "false"]);
    assert.equal(boolArg(args, "x"), true);
    assert.equal(boolArg(args, "y"), true);
    assert.equal(boolArg(args, "z"), false);
    assert.equal(boolArg(args, "missing"), false);
  });
});

describe("parseViewport", () => {
  test("parses WxH with optional whitespace", () => {
    assert.deepEqual(parseViewport("390x844"), { width: 390, height: 844 });
    assert.deepEqual(parseViewport(" 320 x 568 "), { width: 320, height: 568 });
  });

  test("falls back when absent and rejects junk", () => {
    assert.deepEqual(parseViewport(undefined, { width: 1, height: 2 }), { width: 1, height: 2 });
    assert.equal(parseViewport(undefined), null);
    assert.throws(() => parseViewport("390"), /WxH/);
    assert.throws(() => parseViewport("390x844x2"), /WxH/);
  });
});

describe("parseBox", () => {
  test("parses x,y,w,h", () => {
    assert.deepEqual(parseBox("12,4,326,56"), { x: 12, y: 4, width: 326, height: 56 });
  });

  test("rejects wrong arity, non-numbers and non-positive sizes", () => {
    assert.throws(() => parseBox("1,2,3"), /x,y,w,h/);
    assert.throws(() => parseBox("1,2,3,b"), /x,y,w,h/);
    assert.throws(() => parseBox("0,0,0,10"), /positive/);
  });

  test("parseBoxList handles single, array and absent values", () => {
    assert.deepEqual(parseBoxList(undefined), []);
    assert.deepEqual(parseBoxList("0,0,4,4"), [{ x: 0, y: 0, width: 4, height: 4 }]);
    assert.deepEqual(parseBoxList(["0,0,4,4", "1,1,2,2"]).length, 2);
    assert.throws(() => parseBoxList([true]), /mask\[0\]/);
  });
});

describe("formatting", () => {
  test("formatViewport", () => {
    assert.equal(formatViewport({ width: 390, height: 844 }), "390x844");
    assert.equal(formatViewport(null), "default");
  });

  test("roundPercent keeps three decimals", () => {
    assert.equal(roundPercent(1.23456), 1.235);
    assert.equal(roundPercent(0), 0);
  });
});
