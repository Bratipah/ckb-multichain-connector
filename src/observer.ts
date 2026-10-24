import { createHash } from "node:crypto";
import type { CkbConnectorConfig, CkbHash, CkbScript } from "./config.ts";
import { CkbConnectorError } from "./errors.ts";
import type { CkbCellCreatedEventV1 } from "./event.ts";
import { ckbDataHash, ckbScriptHash } from "./hash.ts";
import { CkbRpcClient, type CkbFetch } from "./rpc.ts";

export interface CkbCursor {
  /** Last completely parsed block; the next scan starts at height + 1. */
  lastProcessed?: { height: string; hash: CkbHash };
  /** Retained canonical hashes, bounded by reorgWindow. */
  checkpoints: Array<{ height: string; hash: CkbHash }>;
  /** Emitted events in the retained checkpoint window, needed to report invalidations after restart. */
  observedEvents: CkbCellCreatedEventV1[];
  /** Invalidations retained until a successful batch returns them. */
  pendingInvalidationIds: string[];
}

export interface CkbObservationBatch {
  events: CkbCellCreatedEventV1[];
  /** Previously emitted event IDs invalidated by a detected canonical reorganization. */
  invalidatedEventIds: string[];
  cursor: CkbCursor;
}

export interface CkbObserverOptions {
  fetch?: CkbFetch;
  cursor?: unknown;
}

type ParsedBlock = { height: bigint; hash: CkbHash; transactions: unknown[] };

export class ReadOnlyCkbObserver {
  private readonly rpc: CkbRpcClient;
  private cursor: CkbCursor;
  private readonly knownEvents = new Map<string, CkbCellCreatedEventV1>();

  constructor(
    private readonly config: CkbConnectorConfig,
    options: CkbObserverOptions = {},
  ) {
    this.rpc = new CkbRpcClient(config.rpcUrl, config.requestTimeoutMs, options.fetch);
    this.cursor = validateCursor(options.cursor);
    if (this.cursor.checkpoints.length > config.reorgWindow) {
      throw new CkbConnectorError(
        "CURSOR_INVALID",
        "Cursor exceeds the configured reorganization window.",
      );
    }
    for (const event of this.cursor.observedEvents) this.knownEvents.set(event.eventId, event);
  }

  getCursor(): CkbCursor {
    return structuredClone(this.cursor);
  }

  async observeAvailable(throughHeight?: string): Promise<CkbObservationBatch> {
    const cursorBefore = this.getCursor();
    const eventsBefore = new Map(this.knownEvents);
    try {
      return await this.scanAvailable(throughHeight);
    } catch (error) {
      this.cursor = cursorBefore;
      this.knownEvents.clear();
      for (const [id, event] of eventsBefore) this.knownEvents.set(id, event);
      throw error;
    }
  }

  private async scanAvailable(throughHeight?: string): Promise<CkbObservationBatch> {
    const genesis = await this.rpc.call<unknown>("get_block_by_number", ["0x0"]);
    const genesisBlock = parseBlock(genesis);
    if (genesisBlock.hash !== this.config.genesisBlockHash) {
      throw new CkbConnectorError(
        "CHAIN_MISMATCH",
        "Configured genesis hash does not match the RPC node.",
      );
    }
    const tip = parseHeader(await this.rpc.call<unknown>("get_tip_header", []));
    const confirmationTip = tip.height - BigInt(this.config.confirmationDepth);
    if (throughHeight !== undefined && !/^(0|[1-9][0-9]*)$/.test(throughHeight)) {
      throw new CkbConnectorError(
        "CURSOR_INVALID",
        "throughHeight must be an unsigned decimal integer.",
      );
    }
    const requestedTip = throughHeight === undefined ? confirmationTip : BigInt(throughHeight);
    const eligibleTip = minBigInt(requestedTip, confirmationTip);
    const invalidated = await this.reconcile(tip.height);
    if (eligibleTip < BigInt(this.config.startBlockHeight)) {
      const ids = [...new Set([...this.cursor.pendingInvalidationIds, ...invalidated])];
      this.cursor.pendingInvalidationIds = [];
      return this.batch([], ids);
    }
    let next = this.cursor.lastProcessed
      ? BigInt(this.cursor.lastProcessed.height) + 1n
      : BigInt(this.config.startBlockHeight);
    const events: CkbCellCreatedEventV1[] = [];
    while (next <= eligibleTip) {
      const block = parseBlock(
        await this.rpc.call<unknown>("get_block_by_number", [`0x${next.toString(16)}`]),
      );
      if (block.height !== next) invalidResponse("Block height does not match requested height.");
      const blockEvents = await this.parseEvents(block, tip.height);
      // Commit only after every transaction/output in the block has validated.
      this.cursor.checkpoints.push({ height: next.toString(), hash: block.hash });
      this.cursor.checkpoints = this.cursor.checkpoints.slice(-this.config.reorgWindow);
      this.cursor.lastProcessed = { height: next.toString(), hash: block.hash };
      const retainedHeights = new Set(this.cursor.checkpoints.map((item) => item.height));
      this.cursor.observedEvents = this.cursor.observedEvents.filter((event) =>
        retainedHeights.has(event.source.blockHeight),
      );
      const retainedEventIds = new Set<string>(
        this.cursor.observedEvents.map((event) => event.eventId),
      );
      for (const id of this.knownEvents.keys())
        if (!retainedEventIds.has(id)) this.knownEvents.delete(id);
      for (const event of blockEvents) {
        const prior = this.knownEvents.get(event.eventId);
        this.knownEvents.set(event.eventId, event);
        this.cursor.observedEvents.push(event);
        if (!prior || JSON.stringify(prior) !== JSON.stringify(event)) events.push(event);
      }
      next++;
    }
    const allInvalidated = [...new Set([...this.cursor.pendingInvalidationIds, ...invalidated])];
    this.cursor.pendingInvalidationIds = [];
    return this.batch(events, allInvalidated);
  }

  private async reconcile(tipHeight: bigint): Promise<string[]> {
    const invalidated: string[] = [];
    let mismatch = -1;
    for (let i = 0; i < this.cursor.checkpoints.length; i++) {
      const checkpoint = this.cursor.checkpoints[i];
      if (!checkpoint) invalidResponse("Cursor checkpoint is missing.");
      if (BigInt(checkpoint.height) > tipHeight) {
        mismatch = i;
        break;
      }
      const canonical = parseHeader(
        await this.rpc.call<unknown>("get_header_by_number", [
          `0x${BigInt(checkpoint.height).toString(16)}`,
        ]),
      );
      if (canonical.hash !== checkpoint.hash) {
        mismatch = i;
        break;
      }
    }
    if (mismatch < 0) return invalidated;
    const firstMismatch = this.cursor.checkpoints[mismatch];
    if (!firstMismatch) invalidResponse("Mismatched checkpoint is missing.");
    if (mismatch === 0 && BigInt(firstMismatch.height) > 0n) {
      throw new CkbConnectorError(
        "REORG_WINDOW_EXCEEDED",
        "Canonical mismatch is older than the retained reorganization window; choose an explicit rescan height.",
      );
    }
    const rollbackHeight = BigInt(firstMismatch.height);
    const orphaned = new Set(this.cursor.checkpoints.slice(mismatch).map((item) => item.height));
    for (const event of this.cursor.observedEvents) {
      if (orphaned.has(event.source.blockHeight)) {
        this.knownEvents.delete(event.eventId);
        invalidated.push(event.eventId);
      }
    }
    this.cursor.observedEvents = this.cursor.observedEvents.filter(
      (event) => !orphaned.has(event.source.blockHeight),
    );
    this.cursor.pendingInvalidationIds = [
      ...new Set([...this.cursor.pendingInvalidationIds, ...invalidated]),
    ];
    this.cursor.checkpoints = this.cursor.checkpoints.slice(0, mismatch);
    const prior = this.cursor.checkpoints.at(-1);
    this.cursor.lastProcessed = prior ? { ...prior } : undefined;
    // Replay begins at first replaced height, preserving the last common checkpoint.
    if (prior && BigInt(prior.height) + 1n !== rollbackHeight)
      invalidResponse("Invalid checkpoint sequence.");
    return invalidated;
  }

  private async parseEvents(
    block: ParsedBlock,
    tipHeight: bigint,
  ): Promise<CkbCellCreatedEventV1[]> {
    const result: CkbCellCreatedEventV1[] = [];
    for (let txIndex = 0; txIndex < block.transactions.length; txIndex++) {
      const transaction = parseTransaction(block.transactions[txIndex]);
      for (let outputIndex = 0; outputIndex < transaction.outputs.length; outputIndex++) {
        const output = transaction.outputs[outputIndex];
        if (!matches(output[this.config.targetScript.role], this.config.targetScript.script))
          continue;
        const data = transaction.outputsData[outputIndex];
        if (typeof data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(data))
          invalidResponse("Output data is malformed.");
        const cellDataHash = ckbDataHash(data);
        const eventId = createHash("sha256")
          .update(
            `ckb-cell-created:v1\0${this.config.genesisBlockHash.toLowerCase()}\0${transaction.hash.toLowerCase()}\0${outputIndex}`,
          )
          .digest("hex");
        const typeScript = output.type;
        if (
          typeScript !== null &&
          typeScript !== undefined &&
          (!isRecord(typeScript) ||
            !isHash(typeScript.code_hash) ||
            typeof typeScript.hash_type !== "string" ||
            typeof typeScript.args !== "string")
        )
          invalidResponse("Output type script is malformed.");
        result.push({
          schemaVersion: 1,
          eventId: `ckb-cell-created:${eventId}`,
          source: {
            network: this.config.network,
            genesisBlockHash: this.config.genesisBlockHash,
            blockHeight: block.height.toString(),
            blockHash: block.hash,
            transactionHash: transaction.hash,
            transactionIndex: txIndex.toString(),
          },
          cell: {
            outPoint: { transactionHash: transaction.hash, index: outputIndex.toString() },
            capacityShannons: parseHexQuantity(output.capacity, "capacity").toString(),
            matchedScriptRole: this.config.targetScript.role,
            matchedScriptHash: ckbScriptHash(this.config.targetScript.script),
            ...(typeScript ? { typeScriptHash: ckbScriptHash(parseScript(typeScript)) } : {}),
            dataHash: cellDataHash,
          },
          observation: {
            status: "eligible",
            confirmationDepth: (tipHeight - block.height + 1n).toString(),
            requiredConfirmationDepth: this.config.confirmationDepth.toString(),
          },
        });
      }
    }
    return result;
  }

  private batch(
    events: CkbCellCreatedEventV1[],
    invalidatedEventIds: string[],
  ): CkbObservationBatch {
    return { events, invalidatedEventIds, cursor: this.getCursor() };
  }
}

function validateCursor(value: unknown): CkbCursor {
  if (value === undefined)
    return { checkpoints: [], observedEvents: [], pendingInvalidationIds: [] };
  if (
    !isRecord(value) ||
    !Array.isArray(value.checkpoints) ||
    !Array.isArray(value.observedEvents) ||
    !Array.isArray(value.pendingInvalidationIds) ||
    !value.pendingInvalidationIds.every(
      (id) => typeof id === "string" && /^ckb-cell-created:[0-9a-f]{64}$/.test(id),
    )
  )
    throw new CkbConnectorError(
      "CURSOR_INVALID",
      "Cursor must contain checkpoints and observedEvents arrays.",
    );
  const checkpoints = value.checkpoints.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.height !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(item.height) ||
      !isHash(item.hash)
    )
      throw new CkbConnectorError("CURSOR_INVALID", "Cursor checkpoint is malformed.");
    return { height: item.height, hash: item.hash };
  });
  for (let i = 1; i < checkpoints.length; i++) {
    const current = checkpoints[i];
    const previous = checkpoints[i - 1];
    if (!current || !previous)
      throw new CkbConnectorError("CURSOR_INVALID", "Cursor checkpoint is missing.");
    if (BigInt(current.height) !== BigInt(previous.height) + 1n)
      throw new CkbConnectorError("CURSOR_INVALID", "Cursor checkpoints must be contiguous.");
  }
  let lastProcessed: CkbCursor["lastProcessed"];
  if (value.lastProcessed !== undefined) {
    if (
      !isRecord(value.lastProcessed) ||
      typeof value.lastProcessed.height !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(value.lastProcessed.height) ||
      !isHash(value.lastProcessed.hash)
    )
      throw new CkbConnectorError("CURSOR_INVALID", "Cursor lastProcessed is malformed.");
    lastProcessed = { height: value.lastProcessed.height, hash: value.lastProcessed.hash };
    if (
      checkpoints.at(-1)?.height !== lastProcessed.height ||
      checkpoints.at(-1)?.hash !== lastProcessed.hash
    )
      throw new CkbConnectorError(
        "CURSOR_INVALID",
        "Cursor high-water mark must match its last checkpoint.",
      );
  } else if (checkpoints.length)
    throw new CkbConnectorError("CURSOR_INVALID", "Cursor checkpoints require lastProcessed.");
  const observedEvents = value.observedEvents.map((event) => {
    if (!isCkbEvent(event))
      throw new CkbConnectorError("CURSOR_INVALID", "Cursor contains a malformed observed event.");
    if (
      !checkpoints.some(
        (checkpoint) =>
          checkpoint.height === event.source.blockHeight &&
          checkpoint.hash === event.source.blockHash,
      )
    )
      throw new CkbConnectorError(
        "CURSOR_INVALID",
        "Cursor event is outside its retained canonical checkpoints.",
      );
    return event;
  });
  if (checkpoints.length > 1_000_000)
    throw new CkbConnectorError("CURSOR_INVALID", "Cursor checkpoint history is too large.");
  return {
    checkpoints,
    observedEvents,
    pendingInvalidationIds: [...new Set(value.pendingInvalidationIds as string[])],
    ...(lastProcessed ? { lastProcessed } : {}),
  };
}

function parseBlock(value: unknown): ParsedBlock {
  if (!isRecord(value) || !isRecord(value.header) || !Array.isArray(value.transactions))
    invalidResponse("Block response is missing header or transactions.");
  return {
    height: parseHexQuantity(value.header.number, "block number"),
    hash: ckbHash(value.header.hash),
    transactions: value.transactions,
  };
}
function parseHeader(value: unknown): { height: bigint; hash: CkbHash } {
  if (!isRecord(value)) invalidResponse("Header response is missing.");
  return { height: parseHexQuantity(value.number, "block number"), hash: ckbHash(value.hash) };
}
function parseTransaction(value: unknown): {
  hash: CkbHash;
  outputs: Record<string, unknown>[];
  outputsData: unknown[];
} {
  if (
    !isRecord(value) ||
    !isHash(value.hash) ||
    !isRecord(value.inner) ||
    !Array.isArray(value.inner.outputs) ||
    !Array.isArray(value.inner.outputs_data) ||
    value.inner.outputs.length !== value.inner.outputs_data.length
  )
    invalidResponse(
      "Transaction response is incomplete or has mismatched outputs and outputs_data.",
    );
  const outputs = value.inner.outputs.map((item) => {
    if (!isRecord(item)) invalidResponse("Transaction output is malformed.");
    parseHexQuantity(item.capacity, "capacity");
    parseScript(item.lock as Record<string, unknown>);
    if (item.type !== null && item.type !== undefined)
      parseScript(item.type as Record<string, unknown>);
    return item;
  });
  for (const data of value.inner.outputs_data) {
    if (typeof data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(data))
      invalidResponse("Output data is malformed.");
  }
  return { hash: value.hash, outputs, outputsData: value.inner.outputs_data };
}
function parseScript(value: Record<string, unknown>): CkbScript {
  if (
    !isHash(value.code_hash) ||
    typeof value.hash_type !== "string" ||
    !["data", "type", "data1", "data2"].includes(value.hash_type) ||
    typeof value.args !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(value.args)
  )
    invalidResponse("Output script is malformed.");
  return {
    codeHash: value.code_hash.toLowerCase() as CkbHash,
    hashType: value.hash_type as CkbScript["hashType"],
    args: value.args.toLowerCase() as `0x${string}`,
  };
}
function matches(value: unknown, target: CkbScript): boolean {
  if (value === null || value === undefined) return false;
  const script = parseScript(value as Record<string, unknown>);
  return (
    script.codeHash === target.codeHash &&
    script.hashType === target.hashType &&
    script.args === target.args
  );
}
function parseHexQuantity(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value))
    invalidResponse(`${field} must be a canonical hexadecimal quantity.`);
  const parsed = BigInt(value);
  if (parsed > 18_446_744_073_709_551_615n)
    invalidResponse(`${field} exceeds the CKB uint64 range.`);
  return parsed;
}
function ckbHash(value: unknown): CkbHash {
  if (!isHash(value)) invalidResponse("Expected a 32-byte CKB hash.");
  return value.toLowerCase() as CkbHash;
}
function isHash(value: unknown): value is CkbHash {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function minBigInt(a: bigint, b: bigint): bigint {
  if (a < b) return a;
  return b;
}
function isCkbEvent(value: unknown): value is CkbCellCreatedEventV1 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !/^ckb-cell-created:[0-9a-f]{64}$/.test(String(value.eventId)) ||
    !isRecord(value.source) ||
    !isRecord(value.cell) ||
    !isRecord(value.observation)
  )
    return false;
  const source = value.source;
  const cell = value.cell;
  const point = cell.outPoint;
  const observation = value.observation;
  return (
    ["devnet", "testnet", "mainnet"].includes(String(source.network)) &&
    isHash(source.genesisBlockHash) &&
    isHash(source.blockHash) &&
    isHash(source.transactionHash) &&
    typeof source.blockHeight === "string" &&
    /^(0|[1-9][0-9]*)$/.test(source.blockHeight) &&
    typeof source.transactionIndex === "string" &&
    /^(0|[1-9][0-9]*)$/.test(source.transactionIndex) &&
    isRecord(point) &&
    isHash(point.transactionHash) &&
    typeof point.index === "string" &&
    /^(0|[1-9][0-9]*)$/.test(point.index) &&
    typeof cell.capacityShannons === "string" &&
    /^(0|[1-9][0-9]*)$/.test(cell.capacityShannons) &&
    (cell.matchedScriptRole === "lock" || cell.matchedScriptRole === "type") &&
    isHash(cell.matchedScriptHash) &&
    isHash(cell.dataHash) &&
    observation.status === "eligible" &&
    typeof observation.confirmationDepth === "string" &&
    typeof observation.requiredConfirmationDepth === "string"
  );
}
function invalidResponse(message: string): never {
  throw new CkbConnectorError("RPC_INVALID_RESPONSE", message);
}
