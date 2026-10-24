# Milestone 3 integration design

**Pinned EffectStream revision:** `5604043213df01beccebe253fbb479e387a514bb` (`v-next`, version `0.200.6`).

## Configuration and discovery

EffectStream validates configured networks and sync protocols through the `networkTypes`, `parallelSyncProtocolTypes`, and `syncProtocolCommonResponse` maps in `packages/effectstream-sdk/config`. `SyncProtocolToNetwork` ties each protocol to a network type. `genSyncProtocols` in `packages/node-sdk/sync` explicitly constructs the fetcher and restored state. CKB will be one parallel RPC protocol with a strict network schema; missing or unsupported network values will be rejected by these existing discriminated unions and the factory's unsupported-network error.

## Native data and lifecycle

CKB will use `BaseDataFetcher`, `PaginatedFetcher`, `SyncState`, `ChainBlock`, and the normal orchestration merge. Heights are exact decimal strings at the RPC/event boundary and are converted to the native numeric page type only after a safe-integer check; this reflects the current native `BlockNumber` model and means unsupported heights fail clearly instead of being rounded. Hashes remain full `0x` strings. Transaction hashes and output indices remain present in CKB-specific primitive IO so distinct outpoints cannot collapse. A normalized cell-created event is mapped to the configured CKB primitive; it describes an observed cell output, not an application action or proof.

The fetcher scans deterministic height intervals through the observer's validated RPC and normalization code, returns one native output per required block/page, and sets the last page only after the interval is fully parsed. Native state restoration uses EffectStream's existing page row; per-output resume markers are committed with the normal root block transaction. Errors throw before returning a last page, so retries resume at the failed interval. Native persistence provides at-least-once replay, while primitive event identity must be stable and destination consumers remain responsible for idempotency.

The native page store has no rollback protocol for already committed source pages. The CKB observer will therefore reconcile its bounded canonical checkpoints before exposing each new interval, fail closed when the common checkpoint is outside its retained window, and attach block hashes to outputs. A reorganization discovered after native commit cannot retract prior root/state-machine effects; this residual limitation will be explicit and tested at the adapter boundary. No consumption events or parallel event queue are introduced.

## Package boundary and files

The connector is a standalone package, while the upstream repository is an independent Bun workspace. An unpublished local `file:` or sibling-workspace dependency would make the upstream patch non-reproducible. The integration will add a small CKB sync implementation inside the upstream sync package and depend on the connector's exported package through the immutable Git revision `5f1abe1cddb4a8e92ebf9fc31b262d30423d8a3a`. The connector itself will not copy EffectStream source. Candidate upstream changes are limited to config network/protocol schemas and unions, CKB primitive IO mapping, the sync fetcher/state/factory/type/export, and focused tests.

The original upstream checkout remains pinned and untouched. Changes are developed in a separate worktree branch based on the pinned SHA. The diff and exact dependency pin form the reproducible integration patch; documentation records the file list and apply/test commands.

## Known compatibility constraint

EffectStream stores block heights and persisted resume pages as JavaScript numbers. The connector event contract preserves arbitrary exact integer strings, but native synchronization cannot safely process a height outside `Number.isSafeInteger`. Such heights will be rejected explicitly unless upstream source inspection identifies an existing exact integer page representation. No silent conversion is permitted.
