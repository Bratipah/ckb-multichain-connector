# CKB Multichain Connector

Read-only Nervos CKB observation for cell creations whose lock or type script exactly matches a configured script. The connector validates JSON-RPC responses, emits versioned observations, and exposes a bounded restart cursor. It is standalone and contains no EffectStream runtime code.

## Current scope

- Typed configuration for devnet, testnet, or mainnet RPC observation.
- Exact target lock or type script matching configuration.
- Versioned event contract and read-only block observer.
- No signing key or transaction broadcast path.
- No transaction signing, submission, consensus verification, application action inference, or runtime database recovery.

## Observe blocks

Create a validated config and call `ReadOnlyCkbObserver.observeAvailable()` when polling. It verifies the node's genesis hash, scans through the configured confirmation threshold, and returns a batch containing events, invalidated event IDs, and a cursor:

```ts
import { ReadOnlyCkbObserver, validateCkbConnectorConfig } from "ckb-multichain-connector";

const config = validateCkbConnectorConfig({
  rpcUrl: "http://127.0.0.1:8114",
  network: "devnet",
  genesisBlockHash: "0x...", // 32-byte genesis block hash
  startBlockHeight: "0",
  confirmationDepth: 6,
  reorgWindow: 24,
  requestTimeoutMs: 10_000,
  pollIntervalMs: 3_000,
  targetScript: {
    role: "lock",
    script: { codeHash: "0x...", hashType: "type", args: "0x..." },
  },
});

const observer = new ReadOnlyCkbObserver(config, { cursor: savedCursor });
const batch = await observer.observeAvailable();
// Persist the entire batch atomically with your event handling.
await saveBatchAtomically(batch);
```

`batch.cursor` points to the last fully parsed block. A scan resumes at the following height. The cursor is plain JSON data and can be serialized with `JSON.stringify` and restored with `JSON.parse`. Persist the complete cursor, including retained events and pending invalidations, atomically with handling the batch. If that transaction fails, retry from the previously persisted cursor. Invalidated IDs identify source events from blocks that ceased to be canonical; already submitted destination effects cannot be reversed here. Do not expose or log RPC credentials in application errors.

The reorg window is a bounded policy. A mismatch within retained checkpoints rolls back to the preceding common checkpoint, reports invalidated event IDs, and replays the replacement range. If the oldest retained checkpoint mismatches above genesis, the observer fails closed with `REORG_WINDOW_EXCEEDED`. Confirmation depth lowers risk but does not guarantee finality.

The cursor retains at most `reorgWindow` block hashes and observations. A changed retained checkpoint is reconciled by invalidating events from the orphaned range and replaying replacement blocks. If the earliest retained checkpoint has changed above genesis, the observer fails with `REORG_WINDOW_EXCEEDED`. A fork older than the retained history cannot be detected when all retained hashes remain canonical. The cursor is not a historical event archive or database recovery mechanism. Confirmation depth reduces exposure but is not finality.

See [the event contract](docs/event-contract.md), [architecture audit](docs/architecture-audit.md), and [implementation plan](docs/implementation-plan.md).

## EffectStream boundary

EffectStream integration lives in a separate repository and consumes this package as an observation library. The connector reports matching output cells, canonical block checkpoints, and invalidated event IDs within its retained window. It cannot reverse already committed EffectStream root-block or state-machine effects, reconstruct all historical application inputs, roll back delivered messages or destination transactions, or provide a trustless CKB-to-EVM bridge. Those concerns require independent runtime recovery, durable application journals, and destination reconciliation. The connector does not verify CKB consensus and trusts the configured RPC node's responses.

## Development

Requires Bun `1.3.11` or newer.

```sh
bun install
bun run format:check
bun run lint
bun run typecheck
bun test
```

The supported consumer runtime is Bun: the package export points directly to `src/index.ts`, and Bun consumes the TypeScript source from a local checkout or immutable Git dependency. Node.js consumption is not supported by this package contract; there is no compiled JavaScript build or separately generated declaration bundle.

The pinned Git dependency is the integration install path. `bun pm pack --destination <temporary-directory>` creates a source tarball for package-content validation; the `files` allowlist includes the runtime source, README, and license. For example:

```sh
bun add github:bratipah/ckb-multichain-connector#c07f860030dd5c94725e66ad58c57e0a5b0a8bd0
```

There is no separate build script or generated `dist` directory in this version. Tests use deterministic RPC fixtures and do not need a live node. The optional live smoke procedure for a disposable OffCKB devnet is maintained with the EffectStream integration documentation; never use production keys for observation tests.

Copy `.env.example` to a private local config source and replace the placeholder genesis and script hashes with values from the chosen CKB network. Never put wallet keys in this observer configuration.

## License

MIT. The separately maintained EffectStream upstream remains under its own dual MIT/Apache-2.0 license; this connector contains no copied upstream source.
