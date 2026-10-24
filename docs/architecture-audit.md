# Architecture audit: EffectStream × Nervos CKB

**Audit date:** 2026-10-24
**EffectStream source audited:** [`effectstream/effectstream`](https://github.com/effectstream/effectstream), branch `v-next`, repository tree revision `5604043213df01beccebe253fbb479e387a514bb` (version `0.200.6`).
**Initial workspace status:** at the time of the audit, the connector workspace contained only the audit documents and had no Git history or user changes. The separate upstream checkout was detached at the audited revision, had full (not shallow) history, and had a clean working tree.

## Verified findings

### Repository, stack, and licensing

- The canonical repository is `https://github.com/effectstream/effectstream`; the visible default branch is `v-next`.
- The repository is a TypeScript monorepo using Bun workspaces (`packages/**`, `e2e/**`). Its root package version at the audited revision is `0.200.6`.
- The root and published packages declare dual licensing as `(MIT OR Apache-2.0)`; the root contains `LICENSE-MIT` and `LICENSE-APACHE`. A connector distributed independently should preserve attribution and choose a compatible license after checking the exact license texts and contribution policy.
- Node.js 24.22.0 and npm are available in this environment. Bun is not installed, so upstream commands cannot currently be run here without installing Bun.
- Following the official Bun installation guidance, Bun `1.4.4` was installed through the documented npm method. The upstream monorepo itself does not pin a Bun runtime in `package.json`; its package metadata requests `bun-types` `^1.3.11`, and root scripts use `bun`.
- The EffectStream contribution guide specifies fork-and-pull-request, requires a clear description/reason and relevant test information, and documents `bun test ./packages` and serial E2E runs. No CLA or additional contribution agreement was found in the inspected guide.
- Root test commands are `bun test ./packages` (script `test:code`) and `cd e2e && bun run runner.ts` (script `test:e2e`). The README also documents serial individual suites, for example `cd e2e && bun run runner.ts evm`.

### EffectStream integration points

The upstream README describes `packages/node-sdk/sync` as the blockchain synchronization service and `packages/effectstream-sdk/config` as the config/schema package. Source inspection confirms that CKB does not currently appear in the configured chain support.

Relevant source locations at the audited revision:

- [`packages/node-sdk/sync/src/syncProtocolFactory.ts`](https://github.com/effectstream/effectstream/blob/v-next/packages/node-sdk/sync/src/syncProtocolFactory.ts): `genSyncProtocols(dbConn, syncInfo)` selects a fetcher and state implementation with explicit `networkType` branches. Unsupported network types throw.
- [`packages/node-sdk/sync/src/sync-protocols/base/fetcher.ts`](https://github.com/effectstream/effectstream/blob/v-next/packages/node-sdk/sync/src/sync-protocols/base/fetcher.ts): `BaseDataFetcher` defines the `readData` contract; `PaginatedFetcher` defines page discovery and interval methods.
- [`packages/node-sdk/sync/src/sync-protocols/base/state.ts`](https://github.com/effectstream/effectstream/blob/v-next/packages/node-sdk/sync/src/sync-protocols/base/state.ts): `SyncState` owns pagination state, buffering, persistence interaction, and conversion to root data.
- [`packages/node-sdk/sync/src/sync-protocols/common/root.ts`](https://github.com/effectstream/effectstream/blob/v-next/packages/node-sdk/sync/src/sync-protocols/common/root.ts): `ChainBlock` contains block metadata, per-protocol resume pages, and configured primitives ordered into EffectStream's root timeline.
- [`packages/node-sdk/sync/src/sync-protocols/evm/fetcher.ts`](https://github.com/effectstream/effectstream/blob/v-next/packages/node-sdk/sync/src/sync-protocols/evm/fetcher.ts) and [`evm/state.ts`](https://github.com/effectstream/effectstream/blob/v-next/packages/node-sdk/sync/src/sync-protocols/evm/state.ts): concrete fetcher/state examples. The EVM implementation uses viem, reads configured primitives and blocks, and persists a typed page cursor.
- [`packages/node-sdk/sync/src/sync-protocols/types.ts`](https://github.com/effectstream/effectstream/blob/v-next/packages/node-sdk/sync/src/sync-protocols/types.ts): `AllSyncProtocols` is a closed union of chain-specific states.
- [`packages/effectstream-sdk/config/src/schema/sync-protocols/types.ts`](https://github.com/effectstream/effectstream/blob/v-next/packages/effectstream-sdk/config/src/schema/sync-protocols/types.ts): `ConfigSyncProtocolType`, `SyncProtocolToNetwork`, and protocol-specific primitive types are explicit mappings. No CKB member exists.
- [`packages/effectstream-sdk/config/src/schema/sync-protocols/all.ts`](https://github.com/effectstream/effectstream/blob/v-next/packages/effectstream-sdk/config/src/schema/sync-protocols/all.ts): schema maps for main and parallel protocols are explicit enumerations.
- [`packages/effectstream-sdk/events`](https://github.com/effectstream/effectstream/tree/v-next/packages/effectstream-sdk/events) and [`packages/node-sdk/events`](https://github.com/effectstream/effectstream/tree/v-next/packages/node-sdk/events): MQTT event client/server for runtime block, transaction, primitive, and app events. These are downstream notifications; they are not a pluggable chain-ingestion interface.
- [`packages/node-sdk/sync/README.md`](https://github.com/effectstream/effectstream/blob/v-next/packages/node-sdk/sync/README.md): documents `genSyncProtocols(config)` and sync protocol implementation location.

**Extension finding:** there is a well-defined internal fetcher/state pattern, but no public registration/plugin hook that allows an external package to register a new chain. A native CKB protocol currently requires coordinated additions to config network/protocol schemas, primitive IO mappings, sync protocol fetcher/state exports and types, factory dispatch, and tests. The code should not claim a drop-in external EffectStream adapter until an upstream extension seam exists.

### CKB interfaces and SDK evidence

- Official Nervos documentation describes CKB as a Cell Model chain: transactions consume live Cells and create new Cells; Lock Scripts authorize spending and Type Scripts validate rules. A generic transaction is not necessarily a contract call or application event. See [CKB fundamentals](https://docs.nervos.org/docs/ckb-fundamentals/nervos-blockchain) and [official RPC documentation](https://docs.nervos.org/docs/reference/rpc).
- The CKB JSON-RPC surface includes block/header, transaction, and cell queries. The observer can use block-height pagination and canonical block hashes, but cell spend/create attribution requires reading transaction inputs/outputs and, where necessary, resolving referenced outputs. RPC observation alone trusts the queried node/provider.
- The official Nervos docs recommend CCC for JavaScript/TypeScript CKB development and call Lumos legacy/unmaintained for new projects. CCC's maintained TypeScript SDK includes client abstractions for chain reads as well as transaction composition/signing. The MVP observer is read-only and may use raw JSON-RPC to keep dependencies narrow; transaction composition should use CCC only if the selected local CKB demo needs it. Sources: [Nervos CCC guide](https://docs.nervos.org/docs/sdk-and-devtool/ccc), [CCC repository](https://github.com/ckb-devrel/ccc), [CCC core docs](https://docs.ckbccc.com/docs/packages/core-packages/core).
- CKB official docs show an `offckb` local devnet with node RPC at `http://127.0.0.1:8114` and a debugging proxy at `http://127.0.0.1:28114`; this is a suitable reproducible source chain for the eventual local demonstration. See [Quick Start](https://docs.nervos.org/docs/getting-started/quick-start).

## Compatibility risks

1. EffectStream's current chain model is closed over `ConfigNetworkType`, `ConfigSyncProtocolType`, chain-specific primitive schemas, `AllSyncProtocols`, and the sync factory. There is no external plugin entry point.
2. EffectStream merges source data into timestamp-ordered rollup blocks and persists protocol-specific resume pages. A CKB adapter must satisfy those semantics and recovery rules; a separate polling loop that merely publishes MQTT messages would not be equivalent native chain support.
3. CKB is a cell-based UTXO model, while existing EffectStream examples include account/log or other chain-specific IO. Mapping a CKB cell transition into application primitives requires a clearly defined filter and typed payload rather than treating every transaction as a contract event.
4. CKB canonical-chain changes and EffectStream's confirmation/delay policy need explicit mapping. Inspection of `EvmSyncState` and the sync base code found persisted high-water resume pages but no source-chain rollback protocol. A CKB observer can reconcile its uncommitted scan window, but a deep reorganization after an event is committed into EffectStream cannot safely be represented as a rollback without an upstream runtime feature. A confirmation policy lowers risk but is not finality.
5. EffectStream is Bun-native and pins a number of dependencies. Any independent package needs to verify Node/Bun support and TypeScript module resolution against actual upstream package exports.
6. A destination EVM transaction would be submitted by an operator-controlled signer. EffectStream processing and an RPC-observed CKB event do not independently prove CKB consensus to the destination contract.
7. The upstream baseline unit command ran and found pre-existing failures (details below). After installing Foundry, the pinned EVM E2E baseline passed: 39 passed, 0 failed, 0 skipped.

## Proposed integration architecture

**Recommended package boundary:** a standalone `@effectstream/ckb-connector` package containing a read-only CKB JSON-RPC client, cell/transaction observer, validated canonical event format, deterministic event ID, cursor/reorg handling, and local E2E CLI. Keep CKB signing outside this package initially.

To become native EffectStream sync support, contribute a narrow upstream extension across the existing sync/config stack. Avoid modifying upstream in this workspace until that contribution boundary is agreed at Gate 0. An alternative MQTT/app-event relay can be prototyped separately, but should be labeled an app-level relay and not described as native chain ingestion or as equivalent to the ordered/persisted sync path.

Candidate normalized event (subject to upstream primitive schema):

```ts
type CkbCellTransition = {
  schemaVersion: 1;
  eventId: string; // hash of network + block hash + tx hash + transition identity
  sourceChain: "ckb:testnet" | "ckb:devnet";
  blockHeight: string; // preserve integer precision on the wire
  blockHash: string;
  transactionHash: string;
  transactionIndex?: number;
  cellOutPoint?: { txHash: string; index: string };
  transition: "created" | "consumed";
  scriptIdentity?: { codeHash: string; hashType: string; args: string };
  confirmationDepth: number;
  payload: unknown; // replaced with the application-specific schema before use
};
```

The production event identity must use canonical block/transaction/cell fields, never wall-clock time. Observation status, confirmation depth, and any rollback/reorg record should be maintained separately from the immutable identity. A configurable confirmation threshold reduces risk but is not absolute finality.

## Smallest credible end-to-end MVP

1. Run local CKB devnet (`offckb`) and a local EVM chain.
2. Create a CKB transaction that creates or consumes a cell matching an explicit configured lock/type script.
3. Observe canonical CKB blocks via RPC, normalize matching transition(s), persist cursor and event IDs, and reconcile a changed block hash before treating the event as eligible.
4. Deliver the typed event through the real EffectStream sync/state-machine path after the minimal upstream extension.
5. Execute a bounded local-EVM contract call that records the CKB event ID and source transaction hash, with on-chain duplicate rejection.
6. Persist/report source event ID, CKB tx/block, EffectStream processing status, EVM tx hash, and confirmation/failure state.

Until this full path is executed against both local chains, no live cross-chain integration is considered complete. Public testnet verification is a later supplement.

## Verified facts vs. assumptions

| Item | Status |
|---|---|
| Canonical repository and branch | Verified from repository page and branch source |
| TypeScript/Bun workspaces and package test scripts | Verified from root `package.json` and README |
| Sync factory and protocol/state interfaces | Verified from source files listed above |
| CKB absent from current sync protocol enum/factory union | Verified from inspected source |
| CCC is maintained and recommended for JS/TS | Verified from official docs and CCC repository |
| Exact native CKB primitive contract | Not yet defined; requires mapping to upstream schema and application use case |
| Best CKB event filter | Assumption pending a chosen demo script/cell type |
| Cross-chain local E2E feasible without any upstream edits | No; current source indicates no public registration hook |
| Deep-reorg rollback after EffectStream commits an event | Not provided by the inspected runtime; requires explicit bounded policy or future upstream rollback support |
| Spark Program rules and distribution constraints | Not audited in this milestone |

## Unresolved technical questions

- Which CKB cell/script transition should the demo treat as the application event, and what exact payload is safe for the EffectStream state machine?
- Will the project contribute the minimal native sync/config extension upstream, or remain an external observer with a clearly limited integration claim?
- Which confirmation and canonical-chain reconciliation policy is adequate for the demo?
- Which local EVM chain/toolchain best fits the required EffectStream version and local demonstration?
- Should the connector target Bun only to align with upstream, or support Node too?
- What independent license should the standalone package use, compatible with upstream's dual MIT/Apache-2.0 license?

## Baseline commands and results

- Connector workspace inspection: `pwd`, `ls -la`, `git status`, `rg --files` — the initial workspace was empty and was not a Git repository.
- Upstream checkout: `git clone --filter=blob:none --no-checkout --single-branch --branch v-next ...`; `git checkout --detach 5604043213df01beccebe253fbb479e387a514bb`. Verified `git rev-parse HEAD` equals the pinned revision, `git rev-parse --is-shallow-repository` is `false`, and `git status --short` is clean. Root version `0.200.6`, dual license `(MIT OR Apache-2.0)`, and both license files are present.
- Environment: Node.js `v24.22.0`, npm available, Bun `1.4.4` installed from the official npm distribution. The official Bun docs list `npm install -g bun` as a supported install method: https://bun.sh/docs/installation.
- Dependency install: `bun install` — completed with Bun `1.4.4`, 1,592 packages installed in 673.12 seconds. Bun updated `bun.lock` during install; this environment-only lockfile change will be reverted in the upstream checkout after baseline verification.
- Upstream root unit command: `bun test ./packages` — completed in 298.16 seconds: **602 passed, 4 skipped, 4 failed, 2 errors** (610 tests in 105 files, 1,888 assertions). Failures: two timing assertions in `packages/node-sdk/db/test/pool-error-tracker.test.ts`; errors: `packages/node-sdk/db/src/snapshot-handler.test.ts` could not import named export `test` from `packages/effectstream-sdk/utils/src/runtime.ts`, and `packages/node-sdk/db-emulator/test/examples.test.ts` could not resolve `@effectstream/sm`. Four skips were the two optional Postgres consistency tests (no Postgres binary on PATH), and two multi-file PGlite fixture files intended to run through their parent. No upstream code was changed to address these results.
- Relevant EVM integration command: `PATH="$HOME/.foundry/bin:$PATH" bun run runner.ts evm` from upstream `e2e/` — **39 passed, 0 failed, 0 skipped** (`[PASS] evm`, 71.1s). Foundry `1.8.6` binaries passed installer verification. Upstream checkout was restored to clean status after the run.

## Gate 0 approval and license decision

Gate 0 has been approved for a standalone connector plus the minimum upstream native-sync patch. The connector will use the **MIT License**: it is compatible with EffectStream's `(MIT OR Apache-2.0)` option while keeping the independent package's license simple. No upstream implementation files will be copied into the connector; upstream changes will remain isolated in the pinned checkout for review.
