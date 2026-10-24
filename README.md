# CKB Multichain Connector

Read-only Nervos CKB event observation for matching cell creations. The Milestone 1 foundation provides validated configuration, typed errors, and the versioned event and lifecycle contracts. Milestone 2 adds the validated JSON-RPC client, event normalization, a resumable cursor, and bounded canonical hash reconciliation. Native EffectStream sync integration is not implemented and remains a later milestone.

## Current scope

- Typed configuration for devnet, testnet, or mainnet RPC observation.
- Exact target lock or type script matching configuration.
- Versioned event contract and read-only block observer.
- No signing key or transaction broadcast path.

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
// Persist batch.cursor atomically with staging batch.events and handling invalidatedEventIds.
```

The cursor points to the last fully parsed block. A scan resumes at the following height. The library returns an in-memory cursor; callers must persist it themselves if they need restart recovery. Persist the complete cursor, including retained events and pending invalidations, and atomically stage a returned batch with that cursor. Invalidated IDs represent source events from blocks that ceased to be canonical; already submitted destination effects cannot be reversed here.

The reorg window is a bounded policy. A mismatch within retained checkpoints rolls back to the preceding common checkpoint, reports invalidated event IDs, and replays the replacement range. If the oldest retained checkpoint mismatches above genesis, the observer fails closed with `REORG_WINDOW_EXCEEDED`. Confirmation depth lowers risk but does not guarantee finality.

RPC and parser tests use deterministic fixtures. The test suite passes, but no local CKB node was available during this milestone, so live RPC behavior has not been verified. To verify later, install and start OffCKB (`npm install -g @offckb/cli`, then `offckb node`), read the devnet account scripts with `offckb accounts`, obtain the genesis hash with `curl -s http://127.0.0.1:8114 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"get_block_by_number","params":["0x0"]}'`, put the actual genesis hash and chosen script into the configuration above, then run the application code that calls `observeAvailable()`.

See [the event contract](docs/event-contract.md), [architecture audit](docs/architecture-audit.md), and [implementation plan](docs/implementation-plan.md).

## Development

Requires Bun `1.3.11` or newer.

```sh
bun install
bun run format:check
bun run lint
bun run typecheck
bun test
```

Copy `.env.example` to a private local config source and replace the placeholder genesis and script hashes with values from the chosen CKB network. Never put wallet keys in this observer configuration.

## License

MIT. The separately maintained EffectStream upstream remains under its own dual MIT/Apache-2.0 license; this connector contains no copied upstream source.
