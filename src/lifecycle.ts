import type { CkbCellCreatedEventV1 } from "./event.ts";

export type ConnectorLifecycleStatus = "stopped" | "starting" | "running" | "stopping" | "failed";

export interface ConnectorHealth {
  status: ConnectorLifecycleStatus;
  lastSuccessfulPollAt?: string;
  lastObservedHeight?: string;
  lastErrorCode?: string;
}

export interface CkbObserver {
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): ConnectorHealth;
  observe(fromBlockHeight?: string): AsyncIterable<CkbCellCreatedEventV1>;
}
