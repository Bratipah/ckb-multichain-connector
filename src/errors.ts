export type CkbErrorCode =
  | "CONFIG_INVALID"
  | "RPC_UNAVAILABLE"
  | "RPC_TIMEOUT"
  | "RPC_INVALID_RESPONSE"
  | "RPC_REMOTE_ERROR"
  | "CHAIN_MISMATCH"
  | "REORG_WINDOW_EXCEEDED"
  | "CURSOR_INVALID"
  | "OBSERVER_STOPPED";

export class CkbConnectorError extends Error {
  readonly code: CkbErrorCode;
  readonly retryable: boolean;

  constructor(
    code: CkbErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "CkbConnectorError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface StructuredLogRecord {
  level: "debug" | "info" | "warn" | "error";
  event: string;
  fields?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface StructuredLogger {
  log(record: StructuredLogRecord): void;
}

export function errorLogFields(error: unknown): Readonly<Record<string, string | boolean>> {
  if (error instanceof CkbConnectorError) {
    return {
      name: error.name,
      code: error.code,
      retryable: error.retryable,
      message: redactSensitiveText(error.message),
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSensitiveText(error.message),
      retryable: false,
    };
  }

  return { name: "UnknownError", message: redactSensitiveText(String(error)), retryable: false };
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(
      /([?&][^=&#\s]*(?:key|token|secret|password|auth)[^=&#\s]*=)[^&#\s]*/gi,
      "$1[REDACTED]",
    );
}
