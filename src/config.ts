import { CkbConnectorError } from "./errors.ts";

export type CkbNetwork = "devnet" | "testnet" | "mainnet";
export type CkbScriptRole = "lock" | "type";
export type CkbScriptHashType = "data" | "type" | "data1" | "data2";
export type CkbHash = `0x${string}`;

export interface CkbScript {
  codeHash: CkbHash;
  hashType: CkbScriptHashType;
  args: `0x${string}`;
}

export interface CkbTargetScript {
  role: CkbScriptRole;
  script: CkbScript;
}

export interface CkbConnectorConfig {
  rpcUrl: string;
  network: CkbNetwork;
  genesisBlockHash: CkbHash;
  startBlockHeight: string;
  confirmationDepth: number;
  reorgWindow: number;
  requestTimeoutMs: number;
  pollIntervalMs: number;
  targetScript: CkbTargetScript;
}

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const HEX_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const SCRIPT_HASH_TYPES: readonly CkbScriptHashType[] = ["data", "type", "data1", "data2"];

export function validateCkbConnectorConfig(input: unknown): CkbConnectorConfig {
  if (!isRecord(input)) invalid("Configuration must be an object.");

  const rpcUrl = validateRpcUrl(input.rpcUrl);
  const network = validateNetwork(input.network);
  const genesisBlockHash = validateHash(input.genesisBlockHash, "genesisBlockHash");
  const startBlockHeight = validateDecimal(input.startBlockHeight, "startBlockHeight");
  const confirmationDepth = validateInteger(
    input.confirmationDepth,
    "confirmationDepth",
    0,
    100_000,
  );
  const reorgWindow = validateInteger(input.reorgWindow, "reorgWindow", 1, 1_000_000);
  if (reorgWindow <= confirmationDepth) {
    invalid("reorgWindow must be greater than confirmationDepth.");
  }

  const requestTimeoutMs = validateInteger(input.requestTimeoutMs, "requestTimeoutMs", 1, 120_000);
  const pollIntervalMs = validateInteger(input.pollIntervalMs, "pollIntervalMs", 100, 3_600_000);
  const targetScript = validateTargetScript(input.targetScript);

  return {
    rpcUrl,
    network,
    genesisBlockHash,
    startBlockHeight,
    confirmationDepth,
    reorgWindow,
    requestTimeoutMs,
    pollIntervalMs,
    targetScript,
  };
}

export function redactRpcUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "[REDACTED]";
      url.password = "[REDACTED]";
    }
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveKey(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return url.toString();
  } catch {
    return "[INVALID_RPC_URL]";
  }
}

function validateRpcUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    invalid("rpcUrl must be a non-empty absolute HTTP(S) URL.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalid("rpcUrl must be a non-empty absolute HTTP(S) URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    invalid("rpcUrl must use HTTP or HTTPS.");
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    invalid("HTTP RPC is allowed only for localhost or loopback addresses.");
  }
  if (url.hash) invalid("rpcUrl must not contain a URL fragment.");
  return url.toString();
}

function validateNetwork(value: unknown): CkbNetwork {
  if (value === "devnet" || value === "testnet" || value === "mainnet") return value;
  invalid("network must be devnet, testnet, or mainnet.");
}

function validateHash(value: unknown, field: string): CkbHash {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    invalid(`${field} must be a 32-byte 0x-prefixed hex hash.`);
  }
  return value.toLowerCase() as CkbHash;
}

function validateDecimal(value: unknown, field: string): string {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    invalid(`${field} must be an unsigned decimal integer string.`);
  }
  return value;
}

function validateInteger(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    invalid(`${field} must be a safe integer from ${min} to ${max}.`);
  }
  return value as number;
}

function validateTargetScript(value: unknown): CkbTargetScript {
  if (!isRecord(value) || (value.role !== "lock" && value.role !== "type")) {
    invalid("targetScript.role must be lock or type.");
  }
  const script = value.script;
  if (!isRecord(script)) invalid("targetScript.script must be an object.");
  const codeHash = validateHash(script.codeHash, "targetScript.script.codeHash");
  if (
    typeof script.hashType !== "string" ||
    !SCRIPT_HASH_TYPES.includes(script.hashType as CkbScriptHashType)
  ) {
    invalid("targetScript.script.hashType must be data, type, data1, or data2.");
  }
  if (typeof script.args !== "string" || !HEX_PATTERN.test(script.args)) {
    invalid("targetScript.script.args must be an even-length 0x-prefixed hex string.");
  }
  return {
    role: value.role,
    script: {
      codeHash,
      hashType: script.hashType as CkbScriptHashType,
      args: script.args.toLowerCase() as `0x${string}`,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return /(^|[-_])(api_?key|access_?key|key|access_?token|token|secret|password|auth|authorization|client_?secret)([-_]|$)/.test(
    normalized,
  );
}

function invalid(message: string): never {
  throw new CkbConnectorError("CONFIG_INVALID", message);
}
