# Milestone 3 integration design

**Pinned EffectStream revision:** `5604043213df01beccebe253fbb479e387a514bb` (`v-next`, version `0.200.6`).

## Configuration and discovery

EffectStream validates configured networks and sync protocols through the `networkTypes`, `parallelSyncProtocolTypes`, and `syncProtocolCommonResponse` maps in `packages/effectstream-sdk/config`. `SyncProtocolToNetwork` ties each protocol to a network type. `genSyncProtocols` in `packages/node-sdk/sync` explicitly constructs the fetcher and restored state. CKB will be one parallel RPC protocol with a strict network schema; missing or unsupported network values will be rejected by these existing discriminated unions and the factory's unsupported-network error.

## Native data and lifecycle

CKB will use `BaseDataFetcher`, `PaginatedFetcher`, `SyncState`, `ChainBlock`, and the normal orchestration merge. Heights are exact decimal strings at the RPC/event boundary and are converted to the native numeric page type only after a safe-integer check; this reflects the current native `BlockNumber` model and means unsupported heights fail clearly instead of being rounded. Hashes remain full `0x` strings. Transaction hashes and output indices remain present in CKB-specific primitive IO so distinct outpoints cannot collapse. A normalized cell-created event is mapped to the configured CKB primitive; it describes an observed cell output, not an application action or proof.

The fetcher scans deterministic height intervals through the observer's validated RPC and normalization code, returns one native output per required block/page, and sets the last page only after the interval is fully parsed. Native state restoration uses EffectStream's existing page row; per-output resume markers are committed with the normal root block transaction. Errors throw before returning a last page, so retries resume at the failed interval. Native persistence provides at-least-once replay, while primitive event identity must be stable and destination consumers remain responsible for idempotency.

The native page store has no rollback protocol for already committed source pages. The CKB native page is `{ height, cursor }`, where `height` is a safe integer and `cursor` is the connector observer's bounded checkpoint/event cursor. The page relation compares only height. The adapter calls the observer through one height at a time, so every native output carries the cursor for exactly that block and the runtime's normal per-output resume marker persists it. The fetcher compares committed checkpoint hashes before processing, including while waiting for a new height, and fails closed on replacement. A reorganization discovered after native commit cannot retract prior root/state-machine effects; the operator must stop and perform an explicit recovery. This fail-closed residual limitation is tested at the adapter boundary. No consumption events or parallel event queue are introduced.

## Package boundary and files

The connector is a standalone package, while the upstream repository is an independent Bun workspace. There is no published connector version containing the bounded observer API, and pushing a Git revision was not authorized. The integration worktree therefore uses a Bun `file:` dependency on a sibling connector checkout. The exact connector commit is recorded in the upstream instructions. The reproducible local layout is `GKM/effectstream-ckb-sync` beside `GKM/ckb-multichain-connector`; both exact commits are recorded in the instructions. This integration is suitable for review and local end-to-end verification, but the upstream package diff requires a published or pushed immutable connector revision before it can be applied in an unrelated checkout. The connector itself will not copy EffectStream source. Candidate upstream changes are limited to config network/protocol schemas and unions, CKB primitive IO mapping, the sync fetcher/state/factory/type/export, runtime network handling, and focused tests.

The original upstream checkout remains pinned and untouched. Changes are developed in a separate worktree branch based on the pinned SHA. The diff and exact dependency pin form the reproducible integration patch; documentation records the file list and apply/test commands.

## Known compatibility constraint

EffectStream stores block heights and persisted resume pages as JavaScript numbers. The connector event contract preserves arbitrary exact integer strings, but native synchronization cannot safely process a height outside `Number.isSafeInteger`. Such heights will be rejected explicitly unless upstream source inspection identifies an existing exact integer page representation. No silent conversion is permitted.
