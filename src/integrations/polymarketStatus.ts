import { fetchWithTimeout } from "../http.js";
import { formatEasternDateTime } from "../time.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://status.polymarket.com/";
const summaryApiUrl = "https://status.polymarket.com/api/v2/summary.json";
const componentsApiUrl = "https://status.polymarket.com/api/v2/components.json";
const userAgent = "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1";

export type PolymarketStatusMaintenance = {
  id?: string;
  name?: string;
  start?: string;
  end?: string;
  status?: string;
  duration?: number;
  url?: string;
  updatedAt?: string;
};

export type PolymarketStatusSummaryResponse = {
  page?: {
    name?: string;
    url?: string;
    status?: string;
  };
  activeMaintenances?: PolymarketStatusMaintenance[];
};

export type PolymarketStatusComponent = {
  id?: string;
  name?: string;
  status?: string;
  order?: number;
  activeMaintenances?: PolymarketStatusMaintenance[];
};

export type PolymarketStatusComponentsResponse = {
  components?: PolymarketStatusComponent[];
};

export function extractPolymarketStatusValue(
  summary: PolymarketStatusSummaryResponse,
  componentsResponse: PolymarketStatusComponentsResponse
): string {
  if (!summary.page) {
    throw new Error("Could not find Polymarket status page summary");
  }
  if (!Array.isArray(componentsResponse.components)) {
    throw new Error("Could not find Polymarket status components");
  }

  const components = [...componentsResponse.components].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  const maintenances = collectActiveMaintenances(summary.activeMaintenances ?? [], components);

  return [
    "Metric: Polymarket official status page",
    `Page: ${summary.page.name ?? "Polymarket"}`,
    `Page status: ${formatStatus(summary.page.status)}`,
    "Components:",
    ...(components.length ? components.map(formatComponent) : ["none listed"]),
    "Active maintenances:",
    ...(maintenances.length ? maintenances.map(formatMaintenance) : ["none"]),
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export const polymarketStatusAdapter: WebsiteAdapter = {
  id: "polymarket-status",
  commandName: "polymarketstatus",
  displayName: "Polymarket Status",
  sourceUrl,
  defaultChannelName: "polymarketstatus",
  alertRoleName: "Polymarket Status Alerts",
  alertRoleEmoji: "\uD83D\uDFE3",
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "Fixed 1-minute check for official Polymarket status page changes",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const [summaryResponse, componentsResponse] = await Promise.all([
      fetchWithTimeout(summaryApiUrl, { headers: { accept: "application/json", "user-agent": userAgent } }),
      fetchWithTimeout(componentsApiUrl, { headers: { accept: "application/json", "user-agent": userAgent } })
    ]);

    if (!summaryResponse.ok) {
      throw new Error(`Polymarket status summary API returned HTTP ${summaryResponse.status}`);
    }
    if (!componentsResponse.ok) {
      throw new Error(`Polymarket status components API returned HTTP ${componentsResponse.status}`);
    }

    const value = extractPolymarketStatusValue(
      (await summaryResponse.json()) as PolymarketStatusSummaryResponse,
      (await componentsResponse.json()) as PolymarketStatusComponentsResponse
    );

    return {
      value,
      rawValue: value,
      unit: "Polymarket status",
      observedAt: new Date()
    };
  }
};

function collectActiveMaintenances(
  summaryMaintenances: PolymarketStatusMaintenance[],
  components: PolymarketStatusComponent[]
): Array<PolymarketStatusMaintenance & { componentNames: string[] }> {
  const byId = new Map<string, PolymarketStatusMaintenance & { componentNames: string[] }>();
  for (const maintenance of summaryMaintenances) {
    const id = maintenance.id ?? maintenance.url ?? maintenance.name;
    if (!id) {
      continue;
    }
    byId.set(id, { ...maintenance, componentNames: [] });
  }

  for (const component of components) {
    for (const maintenance of component.activeMaintenances ?? []) {
      const id = maintenance.id ?? maintenance.url ?? maintenance.name;
      if (!id) {
        continue;
      }
      const existing = byId.get(id) ?? { ...maintenance, componentNames: [] };
      if (component.name && !existing.componentNames.includes(component.name)) {
        existing.componentNames.push(component.name);
      }
      byId.set(id, { ...existing, ...maintenance });
    }
  }

  return [...byId.values()].sort((left, right) => Date.parse(left.start ?? "") - Date.parse(right.start ?? ""));
}

function formatComponent(component: PolymarketStatusComponent): string {
  return `${component.name ?? "Unnamed component"}: ${formatStatus(component.status)}`;
}

function formatMaintenance(maintenance: PolymarketStatusMaintenance & { componentNames?: string[] }): string {
  return [
    maintenance.name ?? "Unnamed maintenance",
    `Status: ${formatStatus(maintenance.status)}`,
    `Start: ${formatEasternDateTime(maintenance.start ?? null)}`,
    `End: ${formatEasternDateTime(maintenance.end ?? maintenance.start ?? null)}`,
    `Updated: ${formatEasternDateTime(maintenance.updatedAt ?? null)}`,
    `Components: ${maintenance.componentNames?.length ? maintenance.componentNames.join(", ") : "not listed"}`,
    `Link: ${maintenance.url ?? sourceUrl}`
  ].join("\n");
}

function formatStatus(value: string | undefined): string {
  if (!value) {
    return "unknown";
  }

  const labels: Record<string, string> = {
    OPERATIONAL: "operational",
    DEGRADED: "degraded",
    UNDERMAINTENANCE: "under maintenance",
    ONEUNDERMAINTENANCE: "one component under maintenance",
    PARTIALOUTAGE: "partial outage",
    MAJOROUTAGE: "major outage",
    NOTSTARTEDYET: "not started yet",
    INPROGRESS: "in progress",
    COMPLETED: "completed"
  };
  const normalized = value.trim().toUpperCase();
  const label = labels[normalized] ?? normalized.toLowerCase();
  return `${label} (${normalized})`;
}
