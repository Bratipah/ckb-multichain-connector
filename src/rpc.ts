import { CkbConnectorError } from "./errors.ts";

export type CkbFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class CkbRpcClient {
  private requestId = 0;

  constructor(
    private readonly url: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: CkbFetch = fetch,
  ) {}

  async call<T>(method: string, params: readonly unknown[]): Promise<T> {
    const id = ++this.requestId;
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const timeout = cause instanceof Error && cause.name === "TimeoutError";
      throw new CkbConnectorError(
        timeout ? "RPC_TIMEOUT" : "RPC_UNAVAILABLE",
        timeout ? `CKB RPC ${method} timed out.` : `CKB RPC ${method} could not be reached.`,
        { retryable: true, cause },
      );
    }
    if (!response.ok) {
      throw new CkbConnectorError(
        "RPC_UNAVAILABLE",
        `CKB RPC ${method} returned HTTP ${response.status}.`,
        { retryable: true },
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new CkbConnectorError(
        "RPC_INVALID_RESPONSE",
        `CKB RPC ${method} returned invalid JSON.`,
        { cause },
      );
    }
    if (!isRecord(body) || body.jsonrpc !== "2.0" || body.id !== id) {
      throw new CkbConnectorError(
        "RPC_INVALID_RESPONSE",
        `CKB RPC ${method} returned an invalid JSON-RPC envelope.`,
      );
    }
    if (body.error !== undefined && body.error !== null) {
      const error = body.error;
      if (!isRecord(error) || typeof error.code !== "number" || typeof error.message !== "string") {
        throw new CkbConnectorError(
          "RPC_INVALID_RESPONSE",
          `CKB RPC ${method} returned a malformed error.`,
        );
      }
      throw new CkbConnectorError(
        "RPC_REMOTE_ERROR",
        `CKB RPC ${method} failed (${error.code}): ${error.message}`,
        { retryable: true },
      );
    }
    if (!("result" in body)) {
      throw new CkbConnectorError(
        "RPC_INVALID_RESPONSE",
        `CKB RPC ${method} response omitted result.`,
      );
    }
    return body.result as T;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
