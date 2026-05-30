import {
  createOrnnGpuIndexAdapter,
  extractLatestFinalizedOrnnGpuPoint,
  extractLatestFinalizedOrnnGpuValue,
  extractOrnnGpuPoints,
  type OrnnGpuFinalizedPoint,
  type OrnnGpuIndexPoint
} from "./ornnGpuIndex.js";

export type OrnnH100IndexPoint = OrnnGpuIndexPoint;
export type OrnnH100FinalizedPoint = OrnnGpuFinalizedPoint;

export function extractLatestFinalizedOrnnH100Value(data: unknown): string {
  return extractLatestFinalizedOrnnGpuValue(data, "H100");
}

export function extractLatestFinalizedOrnnH100Point(data: unknown): OrnnH100FinalizedPoint {
  return extractLatestFinalizedOrnnGpuPoint(data);
}

export function extractOrnnH100Points(data: unknown): OrnnH100IndexPoint[] {
  return extractOrnnGpuPoints(data);
}

export const ornnH100IndexAdapter = createOrnnGpuIndexAdapter({
  id: "ornn-h100-index",
  commandName: "ornnh100",
  displayName: "ORNN H100 Index",
  gpuName: "H100",
  defaultPolymarketUrl: "https://polymarket.com/event/gpu-rental-prices-h100-hit-by-may-31",
  defaultChannelName: "ornnh100",
  alertRoleName: "ORNN H100 Alerts"
});
