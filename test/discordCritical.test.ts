import { describe, expect, it } from "vitest";
import {
  extractDiscordCriticalIncidentValue,
  getCriticalDiscordIncidents,
  type DiscordIncidentsResponse
} from "../src/integrations/discordCritical.js";

const noCriticalResponse: DiscordIncidentsResponse = {
  incidents: [
    {
      id: "major-1",
      name: "Major incident",
      status: "resolved",
      impact: "major",
      started_at: "2026-05-01T12:00:00.000-07:00",
      resolved_at: "2026-05-01T13:00:00.000-07:00",
      shortlink: "https://stspg.io/major"
    },
    {
      id: "old-critical",
      name: "Old critical incident",
      status: "resolved",
      impact: "critical",
      started_at: "2025-08-01T12:00:00.000-07:00",
      resolved_at: "2025-08-01T13:00:00.000-07:00",
      shortlink: "https://stspg.io/old"
    }
  ]
};

const criticalResponse: DiscordIncidentsResponse = {
  incidents: [
    {
      id: "critical-old",
      name: "Older critical incident",
      status: "resolved",
      impact: "critical",
      started_at: "2026-03-01T12:00:00.000-08:00",
      resolved_at: "2026-03-01T13:00:00.000-08:00",
      shortlink: "https://stspg.io/old"
    },
    {
      id: "critical-new",
      name: "New critical incident",
      status: "monitoring",
      impact: "critical",
      started_at: "2026-05-02T12:00:00.000-07:00",
      resolved_at: null,
      shortlink: "https://stspg.io/new"
    }
  ]
};

describe("Discord critical incidents adapter", () => {
  it("returns a stable no-critical value when no red incidents exist in the market window", () => {
    expect(extractDiscordCriticalIncidentValue(noCriticalResponse)).toBe(
      "No critical incidents found in Discord incidents feed for the May 31 market window"
    );
  });

  it("formats critical incidents as a monitor value", () => {
    const value = extractDiscordCriticalIncidentValue(criticalResponse);

    expect(value).toContain("CRITICAL INCIDENT DETECTED");
    expect(value).toContain("Incident 1: New critical incident");
    expect(value).toContain("Status: monitoring");
    expect(value).toContain("Resolved: not resolved");
    expect(value).toContain("Link: https://stspg.io/new");
  });

  it("sorts critical incidents newest first", () => {
    expect(getCriticalDiscordIncidents(criticalResponse).map((incident) => incident.id)).toEqual([
      "critical-new",
      "critical-old"
    ]);
  });

  it("throws when the API response has no incident list", () => {
    expect(() => extractDiscordCriticalIncidentValue({})).toThrow("Could not find Discord incidents");
  });
});
