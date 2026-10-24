import type { CkbHash, CkbNetwork, CkbScriptRole } from "./config.ts";

export interface CkbCellCreatedEventV1 {
  schemaVersion: 1;
  eventId: `ckb-cell-created:${string}`;
  source: {
    network: CkbNetwork;
    genesisBlockHash: CkbHash;
    blockHeight: string;
    blockHash: CkbHash;
    transactionHash: CkbHash;
    transactionIndex: string;
  };
  cell: {
    outPoint: { transactionHash: CkbHash; index: string };
    capacityShannons: string;
    matchedScriptRole: CkbScriptRole;
    matchedScriptHash: CkbHash;
    typeScriptHash?: CkbHash;
    dataHash: CkbHash;
  };
  observation: {
    status: "eligible";
    confirmationDepth: string;
    requiredConfirmationDepth: string;
  };
}
