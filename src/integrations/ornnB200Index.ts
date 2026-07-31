import {
  createOrnnGpuIndexAdapter,
  extractLatestFinalizedOrnnGpuPoint,
  extractLatestFinalizedOrnnGpuValue,
  extractOrnnGpuPoints,
  type OrnnGpuFinalizedPoint,
  type OrnnGpuIndexPoint
} from "./ornnGpuIndex.js";

export type OrnnB200IndexPoint = OrnnGpuIndexPoint;
export type OrnnB200FinalizedPoint = OrnnGpuFinalizedPoint;

export function extractLatestFinalizedOrnnB200Value(data: unknown): string {
  return extractLatestFinalizedOrnnGpuValue(data, "B200");
}

export function extractLatestFinalizedOrnnB200Point(data: unknown): OrnnB200FinalizedPoint {
  return extractLatestFinalizedOrnnGpuPoint(data);
}

export function extractOrnnB200Points(data: unknown): OrnnB200IndexPoint[] {
  return extractOrnnGpuPoints(data);
}

export const ornnB200IndexAdapter = createOrnnGpuIndexAdapter({
  id: "ornn-b200-index",
  commandName: "ornnb200",
  displayName: "ORNN B200 Index",
  gpuName: "B200",
  defaultPolymarketUrl: "https://polymarket.com/event/gpu-rental-prices-b200-end-of-august-1785423806591",
  defaultChannelName: "ornnb200",
  alertRoleName: "ORNN B200 Alerts"
});
