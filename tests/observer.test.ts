import { describe, expect, test } from "bun:test";
import { validateCkbConnectorConfig } from "../src/config.ts";
import { CkbConnectorError } from "../src/errors.ts";
import { ckbDataHash, ckbScriptHash } from "../src/hash.ts";
import { ReadOnlyCkbObserver } from "../src/observer.ts";
import { CkbRpcClient, type CkbFetch } from "../src/rpc.ts";

const hash = (n: string): `0x${string}` => `0x${n.repeat(64)}`;
const target = { code_hash: hash("a"), hash_type: "type", args: "0x1234" };
const config = validateCkbConnectorConfig({
  rpcUrl: "http://127.0.0.1:8114",
  network: "devnet",
  genesisBlockHash: hash("0"),
  startBlockHeight: "0",
  confirmationDepth: 0,
  reorgWindow: 4,
  requestTimeoutMs: 1000,
  pollIntervalMs: 100,
  targetScript: { role: "lock", script: { codeHash: hash("a"), hashType: "type", args: "0x1234" } },
});

function tx(id: string, lock = target, capacity = "0x2540be400") {
  return {
    hash: hash(id),
    inner: {
      outputs: [
        { capacity, lock, type: null },
        { capacity: "0x1", lock, type: null },
      ],
      outputs_data: ["0x", "0x1234"],
    },
  };
}
function block(height: number, id: string, transactions: unknown[] = []) {
  return { header: { number: `0x${height.toString(16)}`, hash: hash(id) }, transactions };
}

function fakeFetch(initial: Record<number, unknown>) {
  const chain = new Map(Object.entries(initial).map(([height, value]) => [Number(height), value]));
  const fetcher: CkbFetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    let result: unknown;
    const heightArg = body.params[0];
    if (body.method === "get_block_by_number")
      result = chain.get(Number(BigInt(String(heightArg))));
    else if (body.method === "get_header_by_number") {
      const b = chain.get(Number(BigInt(String(heightArg)))) as
        | ReturnType<typeof block>
        | undefined;
      result = b?.header;
    } else if (body.method === "get_tip_header")
      result = (chain.get(Math.max(...chain.keys())) as ReturnType<typeof block>).header;
    else throw new Error(`Unexpected RPC method ${body.method}`);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
  };
  return {
    fetcher,
    replace(height: number, value: unknown) {
      chain.set(height, value);
    },
  };
}

describe("read-only RPC and CKB parsing", () => {
  test("uses the CKB personalized Blake2b-256 empty input vector", () => {
    expect(ckbDataHash("0x")).toBe(
      "0x44f4c69744d5f8c55d642062949dcae49bc4e7ef43d388c5a12f42b5633d163e",
    );
  });

  test("normalizes matching cells, preserves large capacities, and distinguishes output indices", async () => {
    const rpc = fakeFetch({ 0: block(0, "0"), 1: block(1, "1", [tx("b")]) });
    const observer = new ReadOnlyCkbObserver(config, { fetch: rpc.fetcher });
    const first = await observer.observeAvailable();
    expect(first.events).toHaveLength(2);
    expect(first.events[0]?.cell.capacityShannons).toBe("10000000000");
    expect(first.events[0]?.cell.outPoint.index).toBe("0");
    expect(first.events[1]?.cell.outPoint.index).toBe("1");
    expect(first.events[0]?.eventId).toMatch(/^ckb-cell-created:[0-9a-f]{64}$/);
    expect(first.events[0]?.cell.matchedScriptHash).toBe(ckbScriptHash(config.targetScript.script));
    expect(first.events[0]?.cell.dataHash).toBe(ckbDataHash("0x"));
    expect(first.cursor.lastProcessed?.height).toBe("1");
    expect((await observer.observeAvailable()).events).toHaveLength(0);
  });

  test("bounds an observation at the requested eligible height", async () => {
    const rpc = fakeFetch({
      0: block(0, "0"),
      1: block(1, "1", [tx("b")]),
      2: block(2, "2", [tx("c")]),
    });
    const observer = new ReadOnlyCkbObserver(config, { fetch: rpc.fetcher });
    const first = await observer.observeAvailable("1");
    expect(first.events).toHaveLength(2);
    expect(first.cursor.lastProcessed?.height).toBe("1");
    const second = await observer.observeAvailable("2");
    expect(second.events).toHaveLength(2);
    expect(second.cursor.lastProcessed?.height).toBe("2");
  });

  test("reports orphaned IDs and replays replacement blocks after restart", async () => {
    const rpc = fakeFetch({ 0: block(0, "0"), 1: block(1, "1", [tx("b")]) });
    const original = await new ReadOnlyCkbObserver(config, {
      fetch: rpc.fetcher,
    }).observeAvailable();
    rpc.replace(1, block(1, "c", [tx("d")]));
    const restarted = new ReadOnlyCkbObserver(config, {
      fetch: rpc.fetcher,
      cursor: original.cursor,
    });
    const replacement = await restarted.observeAvailable();
    expect(replacement.invalidatedEventIds).toEqual(original.events.map((event) => event.eventId));
    expect(replacement.events).toHaveLength(2);
    expect(replacement.events[0]?.source.blockHash).toBe(hash("c"));
    expect(replacement.cursor.lastProcessed?.hash).toBe(hash("c"));
  });

  test("fails closed on an incomplete block without advancing its cursor", async () => {
    const rpc = fakeFetch({
      0: block(0, "0"),
      1: block(1, "1", [{ hash: hash("b"), inner: { outputs: [], outputs_data: ["0x"] } }]),
    });
    const observer = new ReadOnlyCkbObserver(config, { fetch: rpc.fetcher });
    await expect(observer.observeAvailable()).rejects.toBeInstanceOf(CkbConnectorError);
    expect(observer.getCursor().lastProcessed).toBeUndefined();
  });

  test("rejects malformed persisted cursors", () => {
    expect(
      () =>
        new ReadOnlyCkbObserver(config, {
          cursor: {
            checkpoints: [{ height: "01", hash: hash("1") }],
            observedEvents: [],
            pendingInvalidationIds: [],
          },
        }),
    ).toThrow("Cursor checkpoint is malformed.");
  });

  test("validates JSON-RPC error envelopes and invalid JSON", async () => {
    const remote = new CkbRpcClient(
      "http://localhost",
      1000,
      async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "bad request" } }),
        ),
    );
    await expect(remote.call("get_tip_header", [])).rejects.toMatchObject({
      code: "RPC_REMOTE_ERROR",
      retryable: true,
    });
    const malformed = new CkbRpcClient(
      "http://localhost",
      1000,
      async () => new Response("no json"),
    );
    await expect(malformed.call("get_tip_header", [])).rejects.toMatchObject({
      code: "RPC_INVALID_RESPONSE",
    });
  });

  test("does not treat a non-matching script as an application event", async () => {
    const otherScript = { code_hash: hash("f"), hash_type: "type", args: "0x1234" };
    const rpc = fakeFetch({ 0: block(0, "0"), 1: block(1, "1", [tx("b", otherScript)]) });
    const result = await new ReadOnlyCkbObserver(config, { fetch: rpc.fetcher }).observeAvailable();
    expect(result.events).toHaveLength(0);
  });
});
