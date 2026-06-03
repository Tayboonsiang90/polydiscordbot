const alchemyFreeEthGetLogsMaxBlocks = 10;

export function getEthGetLogsChunkBlocks(rpcUrl: string | undefined, defaultChunkBlocks: number): number {
  if (isAlchemyRpcUrl(rpcUrl)) {
    return Math.min(defaultChunkBlocks, alchemyFreeEthGetLogsMaxBlocks);
  }

  return defaultChunkBlocks;
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
