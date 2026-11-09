import { describe, expect, test } from "bun:test";
import { ccc } from "@ckb-ccc/core";
import type { CkbScript } from "../src/config.ts";
import { ckbScriptHash } from "../src/hash.ts";

const hash = (byte: string) => `0x${byte.repeat(32)}` as const;
const args = (byte: string, count: number) => `0x${byte.repeat(count)}` as const;

const vectors: CkbScript[] = [
  { codeHash: hash("11"), hashType: "type", args: "0x" },
  { codeHash: hash("22"), hashType: "data", args: "0xab" },
  { codeHash: hash("33"), hashType: "data1", args: args("ab", 20) },
  { codeHash: hash("44"), hashType: "data2", args: args("cd", 32) },
  { codeHash: hash("55"), hashType: "type", args: args("01", 20) },
  { codeHash: hash("66"), hashType: "data", args: args("fe", 32) },
];

describe("CKB script hash CCC parity", () => {
  for (const [index, script] of vectors.entries()) {
    test(`matches CCC for script vector ${index + 1}`, () => {
      const cccHash = ccc.Script.from(script).hash();
      expect(ckbScriptHash(script)).toBe(cccHash);
    });
  }

  test("distinguishes scripts that differ in any matching field", () => {
    const original = vectors[2];
    if (!original) throw new Error("Missing script test vector.");
    const variants: CkbScript[] = [
      { ...original, codeHash: hash("77") },
      { ...original, hashType: "type" },
      { ...original, args: args("ac", 20) },
    ];

    for (const script of variants) {
      const scriptHash = ckbScriptHash(script);
      expect(scriptHash).toBe(ccc.Script.from(script).hash());
      expect(scriptHash).not.toBe(ckbScriptHash(original));
    }
  });
});
