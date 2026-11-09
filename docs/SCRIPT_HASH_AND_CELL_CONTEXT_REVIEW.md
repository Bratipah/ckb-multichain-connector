# Script Hash and Cell Context Review

**Review date:** 2026-11-09  
**Branch inspected:** `feat/ckb-effectstream-sync`  
**Starting working tree:** clean  
**Scope:** Correct script serialization and determine whether the current event model can support complete cell ownership transitions.

## 1. Script hash root cause

`src/hash.ts` serialized the script's `args` as a Molecule `Bytes` value, but wrote `args.length + 4` into its four-byte prefix. CCC's `mol.Bytes` implementation wraps the payload in a length prefix whose value is the payload byte count. The prefix itself is excluded. The connector therefore hashed a noncanonical script serialization whenever computing `matchedScriptHash` (and for any caller of `ckbScriptHash`).

The correction writes `args.length`. The script table size and offsets were already correct: a 16-byte table header, a 32-byte code hash, one hash-type byte, and the encoded args field.

The independent reference is `@ckb-ccc/core` 1.23.0, added as a development-only dependency. `ccc.Script.from(script).hash()` matched the connector for six vectors covering empty args, one-byte args, 20-byte and 32-byte args, all four valid hash types, and several code hashes. Altering code hash, hash type, or args produced a distinct hash and continued to match CCC. Existing observer tests also verify matching and non-matching output scripts.

References: [CCC core package documentation](https://github.com/ckb-devrel/ccc/blob/master/packages/docs/content/docs/packages/core-packages/core.mdx), [CCC script codec source](https://github.com/ckb-devrel/ccc/blob/master/packages/core/src/molecule/codec.ts), and [CKB transaction structure RFC](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0022-transaction-structure/0022-transaction-structure.md).

## 2. Existing event model

The current public contract is `CkbCellCreatedEventV1` in `src/event.ts`, documented in `docs/event-contract.md`:

| Context | V1 representation |
| --- | --- |
| Matched script | Role (`lock` or `type`) and script hash only |
| Lock script | Not emitted |
| Type script | Optional type-script hash only |
| Cell output | Capacity in shannons; no raw output or scripts |
| Cell input | Not parsed or emitted |
| Outpoint | Transaction hash and output index |
| Cell data | Hash only; raw data is omitted |
| Transaction provenance | Transaction hash and transaction index |
| Block provenance | Height and block hash, plus network and genesis hash |
| Creation/consumption | Creation event only |
| Reorganisation | Batch-level list of invalidated creation event IDs; retained cursor checkpoints and observations enable rollback/replay |

The reviewer’s limitation is reproducible. When configured for `role: "type"`, the observer matches `output.type` and records its hash, but does not preserve `output.lock`. This is insufficient to identify the lock owner of a type-matched cell. It also emits no consumption event, so a type script remaining constant across replacement cells cannot by itself reveal an owner transition.

V1 does not expose raw data, scripts, or a matched-script value; it exposes hashes and the match role. A correction to `matchedScriptHash` fixes the value's serialization without changing the V1 schema or event ID format.

## 3. Complete cell-context design (proposed)

No event-contract extension was implemented. Adding lock script, type script, data, and consumed-cell context changes the public payload. The safe design is a deliberate `CkbCellEventV2` (or equivalent versioned cell-transition contract), leaving V1 intact for existing consumers.

V2 should use one cell context shared by created and consumed events: outpoint, capacity, raw data, lock script and hash, optional type script and hash, and transaction/block provenance. It should add an explicit `created`/`consumed` transition and `lock`/`type` matching mode. The match mode should identify why the event was selected while always retaining the full cell context. Existing V1 fields should not be redundantly copied into a second incompatible nesting when a consumer can derive them from the shared cell context.

Raw scripts and data can contain application-specific information; consumers need a documented payload/privacy decision. V2 migration requires dual-version parsing and an EffectStream consumer update, with existing V1 invalidation semantics preserved. No breaking V1 change was made.

## 4. Previous-cell resolution

The current observer iterates transaction outputs only. Transaction inputs carry previous outpoints, not previous cell lock/type/data, and the code neither reads `inputs` nor has a cell-state cache. It cannot emit a reliable consumed-cell event today.

The available live-cell/indexer path is not sufficient as a general historical resolver: a live-cell query describes current live state, while spent cells leave that state. CCC's `getCellLive` is explicitly a live-cell lookup. A robust connector-owned approach would index relevant outputs as blocks are scanned, retain their full cell context keyed by outpoint until consumed, and resolve every input against that state. The state would need durable persistence across restart and a canonical undo journal so a reorganization restores spends and removes orphan-created entries. Its retention is governed by the number of tracked live cells, not just `reorgWindow`; cursor growth and bounded-cursor semantics therefore need a separate design.

This is a larger architecture change than the current caller-persisted bounded cursor. No incomplete or fabricated input information is emitted, and no V2 or state-cache implementation was started. Missing previous-cell state must become an explicit typed failure/coverage gap in any future implementation; it must never be represented as ownership data. A remote archival/indexer service could be evaluated as an alternative, but its availability, retention, and consistency guarantees would need explicit configuration and verification.

References: [CKB cell model](https://docs.nervos.org/docs/tech-explanation/cell), [CKB live-cell DOB example](https://docs.nervos.org/docs/dapp/create-dob), [CKB full-node overview](https://docs.nervos.org/getting-started/run-node).

## 5. Ownership transition test status

No Spore-specific or generic ownership-transition integration test was added because the observer does not resolve consumed cells. A create-Alice / consume / create-Bob reconstruction cannot be truthfully demonstrated with the current event stream. In a future test, Spore-like behavior should be fixture data only: generic connector logic must distinguish lock-script changes from protocol-level NFT ownership semantics, which may have additional type-script rules.

## 6. Regression results

Executed in the connector repository after the correction:

- `bun test`: **32 passed, 0 failed** (includes the new CCC parity suite and existing lock/type matching, cursor restart, deterministic duplicate, and reorganisation tests).
- `bun run typecheck`: passed.
- `bun run lint`: passed.
- `bun run format:check`: passed.

The observer's existing per-block cursor transactionality and reorganisation reconciliation code were not changed. No RPC writes, transaction submission, signing, or other mutating chain calls were introduced. No separate package build script exists in this repository; type checking is its available source-level check.

## 7. Backward compatibility and EffectStream impact

The serialized event schema, event IDs, cursor format, and V1 event shape remain unchanged. Corrected script hashes will differ from the previously emitted incorrect values, so downstream filters or fixtures that pinned those values need review.

The inspected EffectStream integration is pinned immutably to connector commit `c07f860030dd5c94725e66ad58c57e0a5b0a8bd0` in `effectstream-ckb-sync/packages/node-sdk/sync/package.json` and its lockfile. That dependency does not contain this correction. The EffectStream repository was inspected read-only and not modified. Its pin and any hash-based fixtures must be updated in a separate integration change before consumers receive the fix. V2 would require an additional coordinated migration and has not been introduced.

## 8. Remaining limitations

- This observer still reports matching created outputs only.
- It cannot reconstruct ownership transitions or claim NFT ownership tracking is complete.
- Type-script matches still omit the associated lock script in V1.
- Previous-cell resolution needs durable relevant-cell state or a verified archival source, plus reorg rollback for that state.
- EffectStream remains on the old immutable dependency pin until separately updated.

## 9. Recommended next milestone

Design and review the persistent relevant-cell state and reorganisation undo journal first. Specify restart atomicity, scan-start coverage, missing-outpoint behavior, retention, and storage limits. Then define V2 and migration tests, implement created/consumed resolution, and add the Alice-to-Bob replacement test against deterministic fixtures before updating the EffectStream dependency pin. The connector should continue to describe these as cell lock transitions; any assertion that a protocol NFT changed owners belongs to Spore-aware validation above the generic connector.
