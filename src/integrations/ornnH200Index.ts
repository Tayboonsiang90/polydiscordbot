import {
  createOrnnGpuIndexAdapter,
  extractLatestFinalizedOrnnGpuPoint,
  extractLatestFinalizedOrnnGpuValue,
  extractOrnnGpuPoints,
  type OrnnGpuFinalizedPoint,
  type OrnnGpuIndexPoint
} from "./ornnGpuIndex.js";

export type OrnnH200IndexPoint = OrnnGpuIndexPoint;
export type OrnnH200FinalizedPoint = OrnnGpuFinalizedPoint;

export function extractLatestFinalizedOrnnH200Value(data: unknown): string {
  return extractLatestFinalizedOrnnGpuValue(data, "H200");
}

export function extractLatestFinalizedOrnnH200Point(data: unknown): OrnnH200FinalizedPoint {
  return extractLatestFinalizedOrnnGpuPoint(data);
}

export function extractOrnnH200Points(data: unknown): OrnnH200IndexPoint[] {
  return extractOrnnGpuPoints(data);
}

export const ornnH200IndexAdapter = createOrnnGpuIndexAdapter({
  id: "ornn-h200-index",
  commandName: "ornnh200",
  displayName: "ORNN H200 Index",
  gpuName: "H200",
  defaultPolymarketUrl: "https://polymarket.com/event/gpu-rental-prices-h200-hit-by-may-31",
  defaultChannelName: "ornnh200",
  alertRoleName: "ORNN H200 Alerts"
});
