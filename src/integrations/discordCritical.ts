import type { AdapterValue, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";

const apiUrl = "https://discordstatus.com/api/v2/incidents.json";
const sourceUrl = "https://discordstatus.com/history";
const noCriticalValue = "No critical incidents found in Discord incidents feed for the May 31 market window";
const marketWindowStart = Date.parse("2026-01-01T05:00:00.000Z");
const marketWindowEnd = Date.parse("2026-06-01T03:59:59.999Z");

export type DiscordIncident = {
  id?: string;
  name?: string;
  status?: string;
  impact?: string;
  started_at?: string;
  resolved_at?: string | null;
  updated_at?: string;
  shortlink?: string;
};

export type DiscordIncidentsResponse = {
  incidents?: DiscordIncident[];
};

export function extractDiscordCriticalIncidentValue(response: DiscordIncidentsResponse): string {
  const incidents = getCriticalDiscordIncidents(response);

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

export function getCriticalDiscordIncidents(response: DiscordIncidentsResponse): DiscordIncident[] {
  if (!Array.isArray(response.incidents)) {
    throw new Error("Could not find Discord incidents in API response");
  }

  return response.incidents
    .filter((incident) => incident.impact?.toLowerCase() === "critical")
    .filter(isInMarketWindow)
    .sort((left, right) => getIncidentTime(right) - getIncidentTime(left));
}

export const discordCriticalAdapter: WebsiteAdapter = {
  id: "discord-critical-incidents",
  commandName: "discord",
  displayName: "Discord Critical Incidents",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/critical-discord-incident-by-may-31",
  defaultChannelName: "discord-critical",
  alertRoleName: "Discord Critical Alerts",
  alertRoleEmoji: "\uD83D\uDD34",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(apiUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Discord Status returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as DiscordIncidentsResponse;
    const value = extractDiscordCriticalIncidentValue(data);
    return {
      value,
      rawValue: value,
      unit: "critical incident status",
      observedAt: new Date()
    };
  }
};

function isInMarketWindow(incident: DiscordIncident): boolean {
  const timestamp = getIncidentTime(incident);
  return timestamp >= marketWindowStart && timestamp <= marketWindowEnd;
}

function getIncidentTime(incident: DiscordIncident): number {
  const date = incident.resolved_at ?? incident.started_at ?? incident.updated_at ?? "";
  const timestamp = Date.parse(date);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

