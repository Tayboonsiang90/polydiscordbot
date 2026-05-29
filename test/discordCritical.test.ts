import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discordCriticalAdapter,
  discordCriticalShouldAlertOnChange,
  extractDiscordCriticalIncidentValue,
  getCriticalDiscordIncidents,
  parseDiscordCriticalMarketWindow,
  refreshDiscordCriticalPolymarketQueue,
  type DiscordIncidentsResponse
} from "../src/integrations/discordCritical.js";
import type { Integration } from "../src/integrations/types.js";

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
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns a stable no-critical value when no red incidents exist in the market window", () => {
    expect(extractDiscordCriticalIncidentValue(noCriticalResponse)).toBe(
      "No critical incidents found in Discord incidents feed for the Jan 1-May 31 market window"
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

  it("parses month-end market windows from recurring Discord URLs", () => {
    expect(
      parseDiscordCriticalMarketWindow(
        "https://polymarket.com/event/critical-discord-incident-by-june-30",
        new Date("2026-05-29T12:00:00.000Z")
      )
    ).toEqual({
      startAt: "2026-01-01T05:00:00.000Z",
      endAt: "2026-07-01T03:59:00.000Z",
      label: "Jan 1-June 30"
    });
  });

  it("auto-discovers current and next Discord critical markets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "critical-discord-incident-by-may-31",
              title: "Critical Discord Incident by May 31?",
              active: true,
              closed: false,
              tags: [{ slug: "outage" }]
            },
            {
              slug: "critical-discord-incident-by-june-30",
              title: "Critical Discord Incident by June 30?",
              active: true,
              closed: false,
              tags: [{ slug: "outage" }]
            }
          ]
        })
      })
    );

    const result = await refreshDiscordCriticalPolymarketQueue(
      {
        settingsJson: null,
        polymarketUrl: "https://polymarket.com/event/critical-discord-incident-by-may-31"
      } as Integration,
      new Date("2026-05-29T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      polymarketMarkets: Array<{ slug: string; startAt: string; endAt: string }>;
    };

    expect(result.activeUrl).toBe("https://polymarket.com/event/critical-discord-incident-by-may-31");
    expect(settings.polymarketMarkets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "critical-discord-incident-by-may-31",
          startAt: "2026-01-01T05:00:00.000Z",
          endAt: "2026-06-01T03:59:00.000Z"
        }),
        expect.objectContaining({
          slug: "critical-discord-incident-by-june-30",
          startAt: "2026-06-01T04:00:00.000Z",
          endAt: "2026-07-01T03:59:00.000Z"
        })
      ])
    );
  });

  it("switches to the next queued market after month-end rollover", async () => {
    const result = await refreshDiscordCriticalPolymarketQueue(
      {
        settingsJson: JSON.stringify({
          polymarketMarkets: [
            {
              url: "https://polymarket.com/event/critical-discord-incident-by-may-31",
              slug: "critical-discord-incident-by-may-31",
              startAt: "2026-01-01T05:00:00.000Z",
              endAt: "2026-06-01T03:59:00.000Z",
              addedAt: "2026-05-29T12:00:00.000Z"
            },
            {
              url: "https://polymarket.com/event/critical-discord-incident-by-june-30",
              slug: "critical-discord-incident-by-june-30",
              startAt: "2026-06-01T04:00:00.000Z",
              endAt: "2026-07-01T03:59:00.000Z",
              addedAt: "2026-05-29T12:00:00.000Z"
            }
          ],
          lastDiscordCriticalDiscoveryAt: "2026-05-29T12:00:00.000Z"
        }),
        polymarketUrl: "https://polymarket.com/event/critical-discord-incident-by-may-31"
      } as Integration,
      new Date("2026-06-01T12:00:00.000Z")
    );

    expect(result.activeUrl).toBe("https://polymarket.com/event/critical-discord-incident-by-june-30");
  });

  it("alerts only when current value contains a critical incident", () => {
    expect(discordCriticalShouldAlertOnChange(null, extractDiscordCriticalIncidentValue(noCriticalResponse))).toBe(false);
    expect(discordCriticalShouldAlertOnChange(null, extractDiscordCriticalIncidentValue(criticalResponse))).toBe(true);
    expect(discordCriticalAdapter.refreshSettings).toBeDefined();
  });

  it("throws when the API response has no incident list", () => {
    expect(() => extractDiscordCriticalIncidentValue({})).toThrow("Could not find Discord incidents");
  });
});
