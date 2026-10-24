# CKB Multichain Connector implementation plan

**Status as of 2026-10-24:** Gate 0 approved. Milestones 0 and 1 are complete. Milestone 2 read-only RPC observation is implemented and fixture-verified; live-node integration has not been run. Native EffectStream integration and the CKB-to-EVM demonstration remain future work. The MVP cell event contract is recorded in [`event-contract.md`](./event-contract.md).

## Milestone 0 — Repository and environment audit

- [x] Confirm the workspace had no Git history or user changes at the initial audit.
- [x] Identify canonical upstream: `effectstream/effectstream`, branch `v-next`, revision `5604043213df01beccebe253fbb479e387a514bb`.
- [x] Inspect current package layout, root version/license/scripts, sync protocol factory and base/fetcher/state contracts, EVM example, protocol type union, config mapping, and event package role.
- [x] Review official CKB fundamentals, RPC, CCC, and local devnet documentation.
- [x] Draft `docs/architecture-audit.md`.
- [x] Record baseline test status and environment blocker.
- [x] Gate 0: user approved the standalone connector plus minimum native-sync upstream changes.
- [x] Draft the precise CKB cell event contract before implementing the observer.
- [x] Complete exact pinned upstream checkout and dependency install.
- [x] Run the upstream unit baseline; record 602 pass, 4 skip, 4 fail, 2 errors (see the audit for details).
- [x] Install Foundry and rerun the relevant EVM E2E baseline: 39 passed, 0 failed, 0 skipped.

## Recommended sequence after Gate 0

### Milestone 1 — Project foundation

Establish the standalone connector package boundary using TypeScript and the upstream-compatible MIT license. Add strict TypeScript, schema/config validation, secret-safe structured errors/logging, and tests for configuration and event input. Do not add a signing key path.

**Status:** Complete. The original Milestone 1 checks passed with 8 tests and 26 assertions. Those tests cover valid and invalid configuration, endpoint secret redaction, and typed configuration errors; the event and lifecycle contracts are typechecked. Milestone 2 adds RPC observation. Native EffectStream synchronization is not implemented.

**Acceptance:** install/type/lint/unit commands work in the documented runtime; invalid configuration fails with actionable messages; no credentials committed.

### Milestone 2 — Read-only CKB adapter

Implement CKB network identity and JSON-RPC transport, block/header and transaction/cell parsing, configured script filtering, deterministic event identity, cursor, duplicate detection, canonical hash reconciliation, and lifecycle and health contracts. Keep all external RPC data validated and preserve 64-bit quantities as safe strings/bigints.

**Status:** Implemented as a one-shot `ReadOnlyCkbObserver.observeAvailable()` adapter. It validates JSON-RPC envelopes and CKB-shaped block/transaction data, hashes scripts and cell data with CKB-personalized Blake2b, emits matching cell creations with deterministic IDs, tracks block hashes and event IDs in a caller-persisted cursor, reports invalidations, and replays a replaced range within its retained reorg window. A call returns its events and cursor as one batch; on a failed call, its in-memory cursor changes are rolled back. The cursor is not crash-safe unless the caller persists it atomically with event staging. RPC errors are typed; there is no automatic retry/poll scheduler.

**Verification:** fixture-only tests cover normalization, multiple outputs, duplicate scans, malformed data, RPC errors, cursor validation, CKB hash vector, and replacement block rollback/replay. No live CKB node was available or used. `bun run format:check`, `bun run lint`, `bun run typecheck`, and `bun test` pass (15 tests, 46 assertions).

### Milestone 3 — EffectStream integration

If approved, implement the smallest changes in the upstream config schema/network mapping, primitive IO type, fetcher/state, sync protocol union/factory/export, and focused tests. Keep these changes isolated and suitable for upstream review. Use EffectStream's persisted resume pages and state-machine payload path rather than a second queue.

**Acceptance:** an actual CKB-observed event reaches the existing EffectStream processing path; restart/replay tests show no duplicate processing; upstream package tests pass for touched modules.

### Milestone 4 — Local source-to-EVM demonstration

Use offckb and a local EVM development chain. Deploy or reuse a minimal event recorder that stores CKB source identity/event ID and rejects duplicate IDs. Use a clearly explicit local signer configuration; expose submission and confirmation results and correlate them with source processing.

**Acceptance:** real local CKB and EVM interactions traverse the actual EffectStream workflow; success, duplicate rejection, destination failure, delayed confirmation, and outage paths are observed. Any simulated path is labeled as such.

### Milestone 5 — Hardening

Review source reorg handling, finality wording, cursor durability, replay/idempotency semantics, RPC input validation, signing boundary, bounded retries, and secret redaction. Run applicable static/dependency checks and document unsupported recovery cases.

### Milestone 6 — Documentation and Spark preparation

Complete README, architecture, quickstart, security model, testing, troubleshooting, demonstration, and Spark submission docs. Verify current Spark requirements and license/contribution compatibility before making public claims. Include placeholders for unverified grant details.

## Files established after Gate 0

- `docs/architecture-audit.md` (created)
- `docs/implementation-plan.md` (created and updated as work progresses)
- Standalone connector source, package metadata, tests, example CLI, environment example, and documentation, once architecture boundary is approved.
- No EffectStream source is copied into this connector. Native integration changes, if selected later, belong in a separate upstream contribution.

## Environment notes and constraints

- Bun `1.4.4` is installed using the documented npm distribution.
- The upstream checkout audited for this plan was pinned at `5604043213df01beccebe253fbb479e387a514bb`; its baseline results are recorded in [`architecture-audit.md`](./architecture-audit.md).
- The pinned EffectStream revision has no public chain registration hook, so native integration requires upstream changes and remains outside Milestone 2.
- No CKB/EVM credentials or funds are needed for the read-only audit or local-chain design. No secret material should be requested.

## Current concrete event decision

The MVP observes creation of an output cell matching an explicitly configured lock or type script. See [`event-contract.md`](./event-contract.md) for the v1 wire schema, exact deterministic ID derivation, integer representation, eligibility policy, cursor recovery, and trust boundary. This event contract does not claim independent source consensus verification.
