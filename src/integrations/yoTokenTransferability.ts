import type { AdapterValue, WebsiteAdapter } from "./types.js";

export const yoTokenAddress = "0x1925450f5e5fb974b0aae1f3408cf5286fbd1a72";
export const yoTokenSourceUrl = `https://basescan.org/token/${yoTokenAddress}`;

const probeAddress = "0x000000000000000000000000000000000000dead";
const recipientAddress = "0x000000000000000000000000000000000000beef";
const rpcTimeoutMs = 12_000;
const defaultBaseRpcUrls = ["https://mainnet.base.org", "https://base-rpc.publicnode.com"];

type TransferMethod = "transfer" | "transferFrom";

type JsonRpcResponse = {
  result?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
    data?: unknown;
  };
};

export type YoTransferabilitySnapshot = {
  transferEnabled: boolean;
  transferFromEnabled: boolean;
};

type FetchYoTransferabilityOptions = {
  fetchImpl?: typeof fetch;
  rpcUrls?: string[];
};

export const yoTokenTransferabilityAdapter: WebsiteAdapter = {
  id: "yo-token-transferability",
  commandName: "yotransfer",
  displayName: "$YO Transferability",
  sourceUrl: yoTokenSourceUrl,
  defaultChannelName: "yo-token",
  alertRoleName: "YO Token Alerts",
  alertRoleEmoji: "🔓",
  getPollIntervalMinutes(): number {
    return 1;
  },
  getPollIntervalReason(): string {
    return "Read-only Base transfer simulation every minute";
  },
  shouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
    return !isYoTransferabilityEnabled(previousValue) && isYoTransferabilityEnabled(currentValue);
  },
  async fetchCurrentValue(): Promise<AdapterValue> {
    const snapshot = await fetchYoTokenTransferability();
    const enabled = snapshot.transferEnabled || snapshot.transferFromEnabled;
    const value = [
      `Transferability: ${enabled ? "ENABLED" : "NOT PUBLICLY ENABLED"}`,
      `transfer(): ${snapshot.transferEnabled ? "enabled" : "blocked"}`,
      `transferFrom(): ${snapshot.transferFromEnabled ? "enabled" : "blocked"}`,
      "Network: Base",
      `Contract: ${yoTokenAddress}`,
      "Check: read-only zero-value transfer simulations",
      `Resolution: ${yoTokenSourceUrl}`
    ].join("\n");

    return {
      value,
      rawValue: enabled ? "enabled" : "blocked",
      observedAt: new Date()
    };
  }
};

export async function fetchYoTokenTransferability(
  options: FetchYoTransferabilityOptions = {}
): Promise<YoTransferabilitySnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpcUrls = uniqueRpcUrls(options.rpcUrls ?? getConfiguredBaseRpcUrls());
  const errors: string[] = [];

  for (const rpcUrl of rpcUrls) {
    try {
      const [transferEnabled, transferFromEnabled] = await Promise.all([
        simulateTransfer(rpcUrl, "transfer", fetchImpl),
        simulateTransfer(rpcUrl, "transferFrom", fetchImpl)
      ]);
      return { transferEnabled, transferFromEnabled };
    } catch (error) {
      errors.push(`${rpcUrl}: ${formatError(error)}`);
    }
  }

  throw new Error(`Base RPC transferability check failed on all endpoints: ${errors.join("; ")}`);
}

export function buildYoTransferCallData(method: TransferMethod): string {
  const recipient = encodeAddress(recipientAddress);
  const amount = "0".repeat(64);
  if (method === "transfer") {
    return `0xa9059cbb${recipient}${amount}`;
  }

  return `0x23b872dd${encodeAddress(probeAddress)}${recipient}${amount}`;
}

export function parseYoTransferSimulation(payload: JsonRpcResponse): boolean {
  if (payload.error) {
    const message = typeof payload.error.message === "string" ? payload.error.message : "unknown RPC error";
    if (/execution reverted|unauthorized/i.test(message)) {
      return false;
    }
    throw new Error(message);
  }

  if (typeof payload.result !== "string" || !/^0x[0-9a-fA-F]*$/.test(payload.result)) {
    throw new Error("Base RPC returned an invalid eth_call result");
  }
  if (payload.result === "0x") {
    return true;
  }

  return BigInt(payload.result) !== 0n;
}

export function isYoTransferabilityEnabled(value: string | null): boolean {
  return value?.includes("Transferability: ENABLED") ?? false;
}

async function simulateTransfer(rpcUrl: string, method: TransferMethod, fetchImpl: typeof fetch): Promise<boolean> {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "PolymarketResolutionMonitorBot/0.1"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [
        {
          from: probeAddress,
          to: yoTokenAddress,
          data: buildYoTransferCallData(method)
        },
        "latest"
      ]
    }),
    signal: AbortSignal.timeout(rpcTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return parseYoTransferSimulation((await response.json()) as JsonRpcResponse);
}

function getConfiguredBaseRpcUrls(): string[] {
  return uniqueRpcUrls([
    ...splitRpcUrls(process.env.BASE_RPC_URLS),
    ...splitRpcUrls(process.env.BASE_RPC_URL),
    ...defaultBaseRpcUrls
  ]);
}

function splitRpcUrls(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueRpcUrls(urls: string[]): string[] {
  return [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
}

function encodeAddress(address: string): string {
  const normalized = address.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`Invalid Base address: ${address}`);
  }
  return normalized.padStart(64, "0");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
