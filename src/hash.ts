import { blake2b } from "@noble/hashes/blake2b";
import type { CkbHash, CkbScript } from "./config.ts";

const PERSONALIZATION = new TextEncoder().encode("ckb-default-hash");

export function ckbHashBytes(value: Uint8Array): CkbHash {
  return `0x${bytesToHex(blake2b(value, { dkLen: 32, personalization: PERSONALIZATION }))}`;
}

export function ckbScriptHash(script: CkbScript): CkbHash {
  const codeHash = hexToBytes(script.codeHash);
  const args = hexToBytes(script.args);
  const hashType = ({ data: 0, type: 1, data1: 2, data2: 4 } as const)[script.hashType];
  const encodedArgs = new Uint8Array(4 + args.length);
  new DataView(encodedArgs.buffer).setUint32(0, args.length + 4, true);
  encodedArgs.set(args, 4);
  const totalSize = 16 + codeHash.length + 1 + encodedArgs.length;
  const table = new Uint8Array(totalSize);
  const view = new DataView(table.buffer);
  view.setUint32(0, totalSize, true);
  view.setUint32(4, 16, true);
  view.setUint32(8, 48, true);
  view.setUint32(12, 49, true);
  table.set(codeHash, 16);
  table[48] = hashType;
  table.set(encodedArgs, 49);
  return ckbHashBytes(table);
}

export function ckbDataHash(hex: string): CkbHash {
  return ckbHashBytes(hexToBytes(hex));
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex.slice(2), "hex"));
}
function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}
