import { describe, expect, it } from "vitest";
import {
  extractCloudflareCriticalIncidentValue,
  getCriticalCloudflareIncidents,
  type CloudflareIncidentsResponse
} from "../src/integrations/cloudflareCritical.js";

const noCriticalResponse: CloudflareIncidentsResponse = {
  incidents: [
    {
      id: "minor-1",
      name: "Minor incident",
      status: "resolved",
      impact: "minor",
      started_at: "2026-05-01T12:00:00.000Z",
      resolved_at: "2026-05-01T13:00:00.000Z",
      shortlink: "https://stspg.io/minor"
    }
  ]
};

const criticalResponse: CloudflareIncidentsResponse = {
  incidents: [
    {
      id: "critical-old",
      name: "Older critical incident",
      status: "resolved",
      impact: "critical",
      started_at: "2026-05-01T12:00:00.000Z",
      resolved_at: "2026-05-01T13:00:00.000Z",
      shortlink: "https://stspg.io/old"
    },
    {
      id: "critical-new",
      name: "New critical incident",
      status: "monitoring",
      impact: "critical",
      started_at: "2026-05-02T12:00:00.000Z",
      resolved_at: null,
      shortlink: "https://stspg.io/new"
    }
  ]
};

describe("Cloudflare critical incidents adapter", () => {
  it("returns a stable no-critical value when no red incidents exist", () => {
    expect(extractCloudflareCriticalIncidentValue(noCriticalResponse)).toBe(
      "No critical incidents found in Cloudflare incidents feed"
    );
  });

  it("formats critical incidents as a monitor value", () => {
    const value = extractCloudflareCriticalIncidentValue(criticalResponse);

    expect(value).toContain("CRITICAL INCIDENT DETECTED");
    expect(value).toContain("Incident 1: New critical incident");
    expect(value).toContain("Status: monitoring");
    expect(value).toContain("Resolved: not resolved");
    expect(value).toContain("Link: https://stspg.io/new");
  });

  it("sorts critical incidents newest first", () => {
    expect(getCriticalCloudflareIncidents(criticalResponse).map((incident) => incident.id)).toEqual([
      "critical-new",
      "critical-old"
    ]);
  });

  it("throws when the API response has no incident list", () => {
    expect(() => extractCloudflareCriticalIncidentValue({})).toThrow("Could not find Cloudflare incidents");
  });
});
