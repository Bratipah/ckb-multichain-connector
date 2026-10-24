import { describe, expect, test } from "bun:test";
import { redactRpcUrl, validateCkbConnectorConfig } from "../src/config.ts";
import { CkbConnectorError, errorLogFields } from "../src/errors.ts";

const hash = `0x${"ab".repeat(32)}`;

function validConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rpcUrl: "http://127.0.0.1:8114",
    network: "devnet",
    genesisBlockHash: hash,
    startBlockHeight: "0",
    confirmationDepth: 6,
    reorgWindow: 24,
    requestTimeoutMs: 10_000,
    pollIntervalMs: 3_000,
    targetScript: {
      role: "lock",
      script: { codeHash: hash, hashType: "type", args: "0x1234" },
    },
    ...overrides,
  };
}

describe("validateCkbConnectorConfig", () => {
  test("accepts a valid read-only local configuration and canonicalizes hashes", () => {
    const result = validateCkbConnectorConfig(
      validConfig({
        genesisBlockHash: `0x${"AB".repeat(32)}`,
        targetScript: {
          role: "type",
          script: { codeHash: `0x${"CD".repeat(32)}`, hashType: "data1", args: "0xAABB" },
        },
      }),
    );

    expect(result.network).toBe("devnet");
    expect(result.startBlockHeight).toBe("0");
    expect(String(result.genesisBlockHash)).toBe(hash);
    expect(result.targetScript.script.codeHash).toBe(`0x${"cd".repeat(32)}`);
    expect(result.targetScript.script.args).toBe("0xaabb");
  });

  test("accepts HTTPS remote endpoints", () => {
    expect(
      validateCkbConnectorConfig(validConfig({ rpcUrl: "https://rpc.example.org" })).rpcUrl,
    ).toBe("https://rpc.example.org/");
  });

  test("rejects remote HTTP endpoints", () => {
    expect(() =>
      validateCkbConnectorConfig(validConfig({ rpcUrl: "http://rpc.example.org" })),
    ).toThrow("HTTP RPC is allowed only for localhost or loopback addresses.");
  });

  test("rejects malformed and unsafe block heights", () => {
    for (const startBlockHeight of [0, -1, "-1", "01", "1.5", " 2"]) {
      expect(() => validateCkbConnectorConfig(validConfig({ startBlockHeight }))).toThrow();
    }
  });

  test("rejects a reorg window that cannot cover the confirmation depth", () => {
    expect(() =>
      validateCkbConnectorConfig(validConfig({ confirmationDepth: 24, reorgWindow: 24 })),
    ).toThrow("reorgWindow must be greater than confirmationDepth.");
  });

  test("rejects unsupported script hash types and malformed args", () => {
    expect(() =>
      validateCkbConnectorConfig(
        validConfig({
          targetScript: { role: "lock", script: { codeHash: hash, hashType: "data3", args: "0x" } },
        }),
      ),
    ).toThrow("targetScript.script.hashType must be data, type, data1, or data2.");
    expect(() =>
      validateCkbConnectorConfig(
        validConfig({
          targetScript: { role: "lock", script: { codeHash: hash, hashType: "type", args: "0x1" } },
        }),
      ),
    ).toThrow("targetScript.script.args must be an even-length 0x-prefixed hex string.");
  });

  test("does not expose endpoint credentials in sanitized URL output or config errors", () => {
    const secretUrl =
      "https://user:password@rpc.example.org/?api_key=super-secret&key=another-secret";
    const sanitized = redactRpcUrl(secretUrl);
    expect(sanitized).not.toContain("password");
    expect(sanitized).not.toContain("super-secret");
    expect(sanitized).not.toContain("another-secret");

    const error = new CkbConnectorError("RPC_UNAVAILABLE", `Request failed for ${secretUrl}`, {
      retryable: true,
    });
    const fields = errorLogFields(error);
    expect(fields.message).not.toContain("password");
    expect(fields.message).not.toContain("super-secret");
    expect(fields.message).not.toContain("another-secret");
    expect(fields.retryable).toBe(true);
  });

  test("reports configuration failures as typed, non-retryable errors", () => {
    try {
      validateCkbConnectorConfig(validConfig({ network: "unknown" }));
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CkbConnectorError);
      expect((error as CkbConnectorError).code).toBe("CONFIG_INVALID");
      expect((error as CkbConnectorError).retryable).toBe(false);
    }
  });
});
