import type { AdapterValue, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";

const apiUrl = "https://www.cloudflarestatus.com/api/v2/incidents.json";
const sourceUrl = "https://www.cloudflarestatus.com/history";
const noCriticalValue = "No critical incidents found in Cloudflare incidents feed";

export type CloudflareIncident = {
  id?: string;
  name?: string;
  status?: string;
  impact?: string;
  started_at?: string;
  resolved_at?: string | null;
  updated_at?: string;
  shortlink?: string;
};

export type CloudflareIncidentsResponse = {
  incidents?: CloudflareIncident[];
};

export function extractCloudflareCriticalIncidentValue(response: CloudflareIncidentsResponse): string {
  const incidents = getCriticalCloudflareIncidents(response);

  if (incidents.length === 0) {
    return noCriticalValue;
  }

  return [
    "CRITICAL INCIDENT DETECTED",
    ...incidents.slice(0, 5).map((incident, index) =>
      [
        incidents.length > 1 ? `Incident ${index + 1}: ${incident.name ?? "Unnamed incident"}` : `Incident: ${incident.name ?? "Unnamed incident"}`,
        `Status: ${incident.status ?? "unknown"}`,
        `Started: ${incident.started_at ?? "unknown"}`,
        `Resolved: ${incident.resolved_at ?? "not resolved"}`,
        `Link: ${incident.shortlink ?? sourceUrl}`
      ].join("\n")
    )
  ].join("\n\n");
}

export function getCriticalCloudflareIncidents(response: CloudflareIncidentsResponse): CloudflareIncident[] {
  if (!Array.isArray(response.incidents)) {
    throw new Error("Could not find Cloudflare incidents in API response");
  }

  return response.incidents
    .filter((incident) => incident.impact?.toLowerCase() === "critical")
    .sort((left, right) => getIncidentTime(right) - getIncidentTime(left));
}

export const cloudflareCriticalAdapter: WebsiteAdapter = {
  id: "cloudflare-critical-incidents",
  commandName: "cloudflare",
  displayName: "Cloudflare Critical Incidents",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/another-critical-cloudflare-incident-by-995",
  defaultChannelName: "cloudflare-critical",
  alertRoleName: "Cloudflare Critical Alerts",
  alertRoleEmoji: "\uD83D\uDD34",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(apiUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Cloudflare Status returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as CloudflareIncidentsResponse;
    const value = extractCloudflareCriticalIncidentValue(data);
    return {
      value,
      rawValue: value,
      unit: "critical incident status",
      observedAt: new Date()
    };
  }
};

function getIncidentTime(incident: CloudflareIncident): number {
  const date = incident.started_at ?? incident.updated_at ?? "";
  const timestamp = Date.parse(date);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

