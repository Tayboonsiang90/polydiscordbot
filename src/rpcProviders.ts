const alchemyFreeEthGetLogsMaxBlocks = 10;

export type EthGetLogsScanPlan = {
  requestedFromBlock: number;
  fromBlock: number;
  toBlock: number;
  confirmedLatestBlock: number;
  maxScanBlocks: number;
  skippedToLiveHead: boolean;
  cursorAheadOfHead: boolean;
};

export function getEthGetLogsChunkBlocks(rpcUrl: string | undefined, defaultChunkBlocks: number): number {
  if (isAlchemyRpcUrl(rpcUrl)) {
    return Math.min(defaultChunkBlocks, alchemyFreeEthGetLogsMaxBlocks);
  }

  return defaultChunkBlocks;
}

export function advanceLastScannedBlock(currentBlock: unknown, scannedToBlock: number): number {
  return isSafeNonNegativeInteger(currentBlock) ? Math.max(currentBlock, scannedToBlock) : scannedToBlock;
}

export function planEthGetLogsScan(
  rpcUrl: string | undefined,
  requestedFromBlock: number,
  confirmedLatestBlock: number,
  defaultMaxScanBlocks: number
): EthGetLogsScanPlan {
  const maxScanBlocks = isAlchemyRpcUrl(rpcUrl)
    ? Math.min(defaultMaxScanBlocks, alchemyFreeEthGetLogsMaxBlocks)
    : defaultMaxScanBlocks;
  const cursorAheadOfHead = requestedFromBlock > 0 && requestedFromBlock - 1 > confirmedLatestBlock;

  if (requestedFromBlock > confirmedLatestBlock) {
    return {
      requestedFromBlock,
      fromBlock: requestedFromBlock,
      toBlock: confirmedLatestBlock,
      confirmedLatestBlock,
      maxScanBlocks,
      skippedToLiveHead: false,
      cursorAheadOfHead
    };
  }

  if (isAlchemyRpcUrl(rpcUrl) && confirmedLatestBlock - requestedFromBlock + 1 > maxScanBlocks) {
    return {
      requestedFromBlock,
      fromBlock: Math.max(0, confirmedLatestBlock - maxScanBlocks + 1),
      toBlock: confirmedLatestBlock,
      confirmedLatestBlock,
      maxScanBlocks,
      skippedToLiveHead: true,
      cursorAheadOfHead: false
    };
  }

  return {
    requestedFromBlock,
    fromBlock: requestedFromBlock,
    toBlock: Math.min(confirmedLatestBlock, requestedFromBlock + maxScanBlocks - 1),
    confirmedLatestBlock,
    maxScanBlocks,
    skippedToLiveHead: false,
    cursorAheadOfHead: false
  };
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

export function formatEthGetLogsBackfillMode(plan: EthGetLogsScanPlan): string | undefined {
  if (plan.cursorAheadOfHead) {
    return [
      `RPC head ${plan.confirmedLatestBlock} is behind stored cursor ${plan.requestedFromBlock - 1}.`,
      "Keeping the cursor unchanged.",
      "If this persists, check that the RPC URL is on the right chain."
    ].join(" ");
  }

  if (plan.skippedToLiveHead) {
    return [
      "Alchemy Free live-tail scan.",
      `Skipped stale cursor from block ${plan.requestedFromBlock} to ${plan.fromBlock}.`,
      `Scanning newest ${plan.maxScanBlocks} blocks so WebSocket-first alerts stay current.`
    ].join(" ");
  }

  return undefined;
}

export function isAlchemyRpcUrl(rpcUrl: string | undefined): boolean {
  if (!rpcUrl) {
    return false;
  }

  try {
    const hostname = new URL(rpcUrl).hostname.toLowerCase();
    return hostname.endsWith(".alchemy.com") || hostname.endsWith(".alchemyapi.io");
  } catch {
    return rpcUrl.toLowerCase().includes("alchemy");
  }
}
