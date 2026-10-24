# CKB cell creation event contract

**Status:** MVP contract draft, grounded in the CKB cell model and EffectStream's configured primitive path. It will be adjusted only if inspection of the pinned sync schema reveals a concrete incompatibility.

## Selected application event

The MVP event is **creation of an output cell whose configured lock script or type script exactly matches a configured target script**. It is a cell transition observed in a canonical block. It is not a generic transaction event and is not described as a contract call. CKB validates scripts during transaction execution, but the connector's RPC observation trusts its CKB node/provider.

For a transaction output at index `i`, the created cell's outpoint is `(transactionHash, i)`. The observer checks the complete script tuple (`code_hash`, `hash_type`, `args`) for exact match against the selected configured script. A configuration must state which role is targeted: `lock` or `type`. A `lock` script is a spending authorization condition; a `type` script is an application validation rule. The initial implementation will emit at most one event per matching output, even if both configured roles could match, unless the same policy is explicitly configured for both.

## Wire event, schema version 1

```ts
type CkbCellCreatedEventV1 = {
  schemaVersion: 1;
  eventId: `ckb-cell-created:${string}`; // lowercase SHA-256 hex digest
  source: {
    network: "devnet" | "testnet" | "mainnet";
    genesisBlockHash: `0x${string}`; // distinguishes private/local networks
    blockHeight: string; // unsigned decimal integer, no leading zeroes except "0"
    blockHash: `0x${string}`;
    transactionHash: `0x${string}`;
    transactionIndex: string; // unsigned decimal integer
  };
  cell: {
    outPoint: { transactionHash: `0x${string}`; index: string };
    capacityShannons: string; // exact unsigned decimal integer
    matchedScriptRole: "lock" | "type";
    matchedScriptHash: `0x${string}`;
    typeScriptHash?: `0x${string}`;
    dataHash: `0x${string}`;
  };
  observation: {
    status: "eligible";
    confirmationDepth: string;
    requiredConfirmationDepth: string;
  };
};
```

All CKB hashes are validated as 32-byte `0x` prefixed lowercase hex strings. All chain quantities remain decimal strings on the wire and are parsed as `bigint` internally. The payload excludes raw script args and cell data by default because they may expose application data; the hashes and outpoint are sufficient for correlation. Any future payload expansion requires its own schema version and explicit privacy review.

## Event identity and replay

`eventId` is SHA-256 over the UTF-8 byte sequence:

```text
ckb-cell-created:v1\0<genesisBlockHash-lowercase>\0<transactionHash-lowercase>\0<outputIndex-decimal>
```

The ID binds to the chain instance and immutable output outpoint, not wall-clock time or block location. If the same transaction is re-included in a different canonical block after a reorganization, the same output retains its identity while its canonical block metadata is updated. Destination idempotency must key on `eventId`. The block hash and height remain in the event for audit and canonical-chain reconciliation.

## Eligibility, cursor, and canonical-chain changes

- A block is eligible only after it is at or below `tipHeight - requiredConfirmationDepth`. A confirmation threshold is a risk policy, not absolute finality.
- The observer stores its last processed height together with the hash at that height. On restart, it checks that checkpoint against the node's canonical block. If it differs, it walks backward to a common retained checkpoint and replays forward. A bounded reorg window must be configured; if no common checkpoint is available, the observer fails closed and requires an operator-selected rescan height.
- Each emitted candidate includes its block hash. Before handing an eligible event to an irreversible destination action, the processing path should confirm that this hash is still canonical. Reorganizations after destination submission are recorded as source invalidation; the connector cannot atomically reverse an already-mined EVM transaction.
- The cursor advances only after a complete block has been parsed and its matching events have been durably staged. The native EffectStream implementation must use EffectStream's protocol resume-page persistence rather than adding a competing checkpoint database.
- Event IDs deduplicate repeated RPC responses and replayed blocks. Block metadata can be refreshed for a canonical re-inclusion without repeating the destination effect.

EffectStream's inspected resume model persists forward progress but does not expose a rollback mechanism for already committed state-machine inputs. Therefore, the initial native integration can detect and reconcile reorganizations before commit within its retained scan window, and must fail closed if the checkpoint no longer matches. A deeper reorganization after commit is an explicitly documented residual risk; this MVP does not claim to reverse the state machine or a destination transaction.

## Trust boundary

This event means: **the configured CKB RPC provider reported a matching output in the indicated block, and that block met the configured depth policy at observation time**. It is not a CKB proof verified by the EVM contract or by an independent light client. A provider may return incomplete or dishonest data. Logs and audit records must preserve the provider/network identity and the source block/transaction references.
