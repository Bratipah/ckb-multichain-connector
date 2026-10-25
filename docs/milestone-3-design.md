# Milestone 3 integration design

**Pinned EffectStream revision:** `5604043213df01beccebe253fbb479e387a514bb` (`v-next`, version `0.200.6`).

**Integration commits:** `3adc2a511f5c1edeaa78821c14d17f3b1174cb52` and `e5e9c0e5` on `feat/ckb-native-sync`.

**Connector dependency commit:** `b8353e5` on `feat/ckb-effectstream-sync` (bounded observation API and persistence design).

## Configuration and discovery

EffectStream validates configured networks and sync protocols through the `networkTypes`, `parallelSyncProtocolTypes`, and `syncProtocolCommonResponse` maps in `packages/effectstream-sdk/config`. `SyncProtocolToNetwork` ties each protocol to a network type. `genSyncProtocols` in `packages/node-sdk/sync` explicitly constructs the fetcher and restored state. CKB will be one parallel RPC protocol with a strict network schema; missing or unsupported network values will be rejected by these existing discriminated unions and the factory's unsupported-network error.

## Native data and lifecycle

CKB will use `BaseDataFetcher`, `PaginatedFetcher`, `SyncState`, `ChainBlock`, and the normal orchestration merge. Heights are exact decimal strings at the RPC/event boundary and are converted to the native numeric page type only after a safe-integer check; this reflects the current native `BlockNumber` model and means unsupported heights fail clearly instead of being rounded. Hashes remain full `0x` strings. Transaction hashes and output indices remain present in CKB-specific primitive IO so distinct outpoints cannot collapse. A normalized cell-created event is mapped to the configured CKB primitive; it describes an observed cell output, not an application action or proof.

The fetcher scans deterministic height intervals through the observer's validated RPC and normalization code, returns one native output per required block/page, and sets the last page only after the interval is fully parsed. Native state restoration uses EffectStream's existing page row; per-output resume markers are committed with the normal root block transaction. Errors throw before returning a last page, so retries resume at the failed interval. Native persistence provides at-least-once replay, while primitive event identity must be stable and destination consumers remain responsible for idempotency.

The native page store has no rollback protocol for already committed source pages. The CKB native page is `{ height, cursor }`, where `height` is a safe integer and `cursor` is the connector observer's bounded checkpoint/event cursor. The page relation compares only height. The adapter calls the observer through one height at a time, so every native output carries the cursor for exactly that block and the runtime's normal per-output resume marker persists it. The fetcher compares committed checkpoint hashes before processing, including while waiting for a new height, and fails closed on replacement. A reorganization discovered after native commit cannot retract prior root/state-machine effects. The operator must stop the affected runtime, preserve the database, and investigate affected checkpoint heights and persisted effects; there is no validated production repair procedure, so this limitation keeps the acceptance gate open. This fail-closed behavior is tested at the adapter boundary. No consumption events or parallel event queue are introduced.

## Package boundary and files

The connector is a standalone package, while the upstream repository is an independent Bun workspace. There is no published connector version containing the bounded observer API, and pushing a Git revision was not authorized. The integration worktree therefore uses a Bun `file:` dependency on a sibling connector checkout. The required bounded API was previously recorded at connector commit `b8353e5`, which is not available on the public remote. The live RPC audit found another necessary parser change: current CKB block RPC transactions expose `outputs` and `outputs_data` directly rather than under `inner`. That fix and its regression test are currently uncommitted on `feat/ckb-effectstream-sync` after HEAD `58e9786`. The reproducible local layout is `GKM/effectstream-ckb-sync` beside `GKM/ckb-multichain-connector`. This integration is suitable for local review and live verification, but a clean immutable Git dependency cannot be set until a connector commit containing both required changes is reachable remotely. Bun 1.4.4 supports pinned Git commit dependencies; npm DNS failures also prevented completing the frozen-lockfile installation in this environment. The connector itself will not copy EffectStream source. Candidate upstream changes are limited to config network/protocol schemas and unions, CKB primitive IO mapping, the sync fetcher/state/factory/type/export, runtime network handling, and focused tests.

The original upstream checkout remains pinned and untouched. Changes are developed in a separate worktree branch based on the pinned SHA. The diff and exact dependency pin form the reproducible integration patch; documentation records the file list and apply/test commands.

## Known compatibility constraint

EffectStream stores block heights and persisted resume pages as JavaScript numbers. The connector event contract preserves arbitrary exact integer strings, but native synchronization cannot safely process a height outside `Number.isSafeInteger`. Such heights will be rejected explicitly unless upstream source inspection identifies an existing exact integer page representation. No silent conversion is permitted.
