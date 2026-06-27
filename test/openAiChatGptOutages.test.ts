import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractOpenAiChatGptComponentsFromStatusHtml,
  extractOpenAiIncidentComponentImpacts,
  extractOpenAiStatusIncidentsFromHistoryHtml,
  filterNewOpenAiDailyReportDay,
  formatOpenAiChatGptOutageValue,
  getOpenAiChatGptOutagePeriod,
  getOpenAiChatGptQualifyingOutages,
  getOpenAiReviewOutages,
  openAiChatGptOutagesAdapter,
  openAiChatGptOutagesShouldAlertOnChange,
  refreshOpenAiChatGptOutagePolymarketQueue
} from "../src/integrations/openAiChatGptOutages.js";
import type { Integration } from "../src/integrations/types.js";

const statusHtml = String.raw`
  \"component\":\"$undefined\",\"group\":{\"components\":[
  {\"component_id\":\"chat-conv\",\"data_available_since\":\"2025-01-01T00:00:00Z\",\"name\":\"Conversations\"},
  {\"component_id\":\"chat-search\",\"data_available_since\":\"2025-01-01T00:00:00Z\",\"name\":\"Search\"}
  ],\"description\":\"https://chat.openai.com\",\"display_aggregated_uptime\":true,\"id\":\"chatgpt-group\",\"name\":\"ChatGPT\"}
`;

const qualifyingDetailHtml = String.raw`
  \"component_impacts\":[
  {\"component_id\":\"chat-conv\",\"end_at\":\"2026-06-03T05:30:00Z\",\"id\":\"impact-1\",\"start_at\":\"2026-06-02T23:30:00Z\",\"status\":\"partial_outage\",\"status_page_incident_id\":\"incident-1\"},
  {\"component_id\":\"api-responses\",\"end_at\":\"2026-06-03T01:00:00Z\",\"id\":\"impact-2\",\"start_at\":\"2026-06-03T00:00:00Z\",\"status\":\"partial_outage\",\"status_page_incident_id\":\"incident-1\"},
  {\"component_id\":\"chat-search\",\"end_at\":\"2026-06-03T02:00:00Z\",\"id\":\"impact-3\",\"start_at\":\"2026-06-03T01:00:00Z\",\"status\":\"degraded_performance\",\"status_page_incident_id\":\"incident-1\"}
  ]
`;

const apiOnlyPartialOutageHtml = String.raw`
  \"component_impacts\":[
  {\"component_id\":\"api-responses\",\"end_at\":\"2026-05-09T00:40:00Z\",\"id\":\"impact-api\",\"start_at\":\"2026-05-08T23:05:00Z\",\"status\":\"partial_outage\",\"status_page_incident_id\":\"incident-api\"}
  ]
`;

const historyHtmlWithOlderChatGptIncident = String.raw`
  \"component_impacts\":[
  {\"component_id\":\"chat-conv\",\"end_at\":\"2026-06-01T17:28:52.577Z\",\"id\":\"impact-old\",\"start_at\":\"2026-06-01T16:26:44.837Z\",\"status\":\"partial_outage\",\"status_page_incident_id\":\"01KT204M76EYZYJX7WYG1B2QPH\"},
  {\"component_id\":\"chat-conv\",\"end_at\":\"2026-06-02T17:28:52.577Z\",\"id\":\"impact-other\",\"start_at\":\"2026-06-02T16:26:44.837Z\",\"status\":\"partial_outage\",\"status_page_incident_id\":\"incident-other\"}
  ],\"id\":\"01KT204M76EYZYJX7WYG1B2QPH\",\"name\":\"Decreased ChatGPT availability for Free users\",\"published_at\":\"2026-06-01T16:26:44.837Z\",\"status\":\"resolved\",\"status_page_id\":\"status-page\",\"status_summaries\":[{\"end_at\":\"2026-06-01T17:28:52.577Z\",\"start_at\":\"2026-06-01T16:26:44.837Z\",\"worst_component_status\":\"partial_outage\"}],\"type\":\"incident\",\"updates\":[{\"published_at\":\"2026-06-01T16:26:44.837Z\",\"to_status\":\"identified\"},{\"published_at\":\"2026-06-01T17:28:52.577Z\",\"to_status\":\"resolved\"}],\"write_up_contents\":\"$undefined\"
`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OpenAI ChatGPT outage adapter", () => {
  it("parses ChatGPT component ids from the OpenAI status page group", () => {
    expect(extractOpenAiChatGptComponentsFromStatusHtml(statusHtml)).toEqual([
      { id: "chat-conv", name: "Conversations" },
      { id: "chat-search", name: "Search" }
    ]);
  });

  it("parses incident component impact timelines from incident pages", () => {
    expect(extractOpenAiIncidentComponentImpacts(qualifyingDetailHtml)).toEqual(
      expect.arrayContaining([
        {
          componentId: "chat-conv",
          endAt: "2026-06-03T05:30:00Z",
          incidentId: "incident-1",
          startAt: "2026-06-02T23:30:00Z",
          status: "partial_outage"
        }
      ])
    );
  });

  it("parses older incidents from the OpenAI status history page", () => {
    expect(extractOpenAiStatusIncidentsFromHistoryHtml(historyHtmlWithOlderChatGptIncident)).toEqual([
      {
        id: "01KT204M76EYZYJX7WYG1B2QPH",
        name: "Decreased ChatGPT availability for Free users",
        status: "resolved",
        created_at: "2026-06-01T16:26:44.837Z",
        resolved_at: "2026-06-01T17:28:52.577Z"
      }
    ]);
  });

  it("counts only resolved ChatGPT partial/full outage days in the ET month", () => {
    const period = getOpenAiChatGptOutagePeriod({ settingsJson: JSON.stringify({ year: 2026, month: 6 }) } as Integration);
    const outages = getOpenAiChatGptQualifyingOutages({
      incidents: [
        {
          id: "incident-1",
          name: "ChatGPT issue",
          status: "resolved",
          created_at: "2026-06-02T23:30:00Z",
          resolved_at: "2026-06-03T05:30:00Z"
        },
        {
          id: "incident-2",
          name: "Still ongoing",
          status: "monitoring",
          created_at: "2026-06-04T12:00:00Z",
          resolved_at: null
        }
      ],
      detailHtmlByIncidentId: new Map([
        ["incident-1", qualifyingDetailHtml],
        [
          "incident-2",
          String.raw`{\"component_id\":\"chat-conv\",\"end_at\":\"2026-06-04T13:00:00Z\",\"id\":\"impact-4\",\"start_at\":\"2026-06-04T12:00:00Z\",\"status\":\"full_outage\",\"status_page_incident_id\":\"incident-2\"}`
        ]
      ]),
      chatGptComponents: extractOpenAiChatGptComponentsFromStatusHtml(statusHtml),
      period
    });

    expect(outages).toEqual([
      expect.objectContaining({
        id: "incident-1",
        componentNames: ["Conversations"],
        componentStatuses: ["partial_outage"],
        outageDatesEt: ["2026-06-02", "2026-06-03"]
      })
    ]);
  });

  it("counts qualifying incidents found only on the OpenAI status history page", () => {
    const period = getOpenAiChatGptOutagePeriod({ settingsJson: JSON.stringify({ year: 2026, month: 6 }) } as Integration);
    const incidents = extractOpenAiStatusIncidentsFromHistoryHtml(historyHtmlWithOlderChatGptIncident);
    const outages = getOpenAiChatGptQualifyingOutages({
      incidents,
      detailHtmlByIncidentId: new Map([["01KT204M76EYZYJX7WYG1B2QPH", historyHtmlWithOlderChatGptIncident]]),
      chatGptComponents: extractOpenAiChatGptComponentsFromStatusHtml(statusHtml),
      period
    });

    expect(outages).toEqual([
      expect.objectContaining({
        id: "01KT204M76EYZYJX7WYG1B2QPH",
        componentNames: ["Conversations"],
        componentStatuses: ["partial_outage"],
        outageDatesEt: ["2026-06-01"]
      })
    ]);
  });

  it("formats current value and alerts only when new outage days appear", () => {
    const period = getOpenAiChatGptOutagePeriod({ settingsJson: JSON.stringify({ year: 2026, month: 6 }) } as Integration);
    const value = formatOpenAiChatGptOutageValue(
      [
        {
          id: "incident-1",
          name: "ChatGPT issue",
          resolvedAt: "2026-06-03T05:30:00Z",
          url: "https://status.openai.com/incidents/incident-1",
          componentNames: ["Conversations"],
          componentStatuses: ["partial_outage"],
          outageDatesEt: ["2026-06-02", "2026-06-03"]
        }
      ],
      period
    );

    expect(value).toContain("Qualifying days: 2");
    expect(value).toContain("Days: 2026-06-02, 2026-06-03");
    expect(openAiChatGptOutagesShouldAlertOnChange(null, value)).toBe(true);
    expect(openAiChatGptOutagesShouldAlertOnChange(value, value)).toBe(false);
  });

  it("alerts once for the latest completed ET day even with no outage", () => {
    const period = getOpenAiChatGptOutagePeriod({ settingsJson: JSON.stringify({ year: 2026, month: 6 }) } as Integration);
    const first = filterNewOpenAiDailyReportDay(null, period, new Date("2026-06-05T14:00:00.000Z"));
    const storedValue = formatOpenAiChatGptOutageValue([], period, [], first);
    const second = filterNewOpenAiDailyReportDay(storedValue, period, new Date("2026-06-05T15:00:00.000Z"));
    const quietValue = formatOpenAiChatGptOutageValue([], period, [], second);

    expect(first.newDailyReportDay).toBe("2026-06-04");
    expect(first.reportedDailyDates).toEqual(["2026-06-04"]);
    expect(storedValue).toContain("2026-06-04 ET - no qualifying ChatGPT Partial/Full Outage currently detected");
    expect(openAiChatGptOutagesShouldAlertOnChange(null, storedValue)).toBe(true);
    expect(second.newDailyReportDay).toBeNull();
    expect(second.reportedDailyDates).toEqual(["2026-06-04"]);
    expect(openAiChatGptOutagesShouldAlertOnChange(storedValue, quietValue)).toBe(false);
  });

  it("includes non-ChatGPT partial/full outages as review-only items", () => {
    const period = getOpenAiChatGptOutagePeriod({ settingsJson: JSON.stringify({ year: 2026, month: 5 }) } as Integration);
    const input = {
      incidents: [
        {
          id: "incident-api",
          name: "Elevated errors for Responses API",
          status: "resolved",
          created_at: "2026-05-08T23:05:00Z",
          resolved_at: "2026-05-09T00:08:01Z"
        }
      ],
      detailHtmlByIncidentId: new Map([["incident-api", apiOnlyPartialOutageHtml]]),
      chatGptComponents: extractOpenAiChatGptComponentsFromStatusHtml(statusHtml),
      period
    };
    const qualifyingOutages = getOpenAiChatGptQualifyingOutages(input);
    const reviewOutages = getOpenAiReviewOutages(input);
    const value = formatOpenAiChatGptOutageValue(qualifyingOutages, period, reviewOutages);

    expect(qualifyingOutages).toEqual([]);
    expect(reviewOutages).toEqual([expect.objectContaining({ id: "incident-api", isChatGptAffected: false })]);
    expect(value).toContain("Qualifying days: 0");
    expect(value).toContain("REVIEW: 2026-05-08 — Elevated errors for Responses API");
    expect(value).toContain("Components: api-responses");
    expect(openAiChatGptOutagesShouldAlertOnChange(null, value)).toBe(false);
  });

  it("uses month/year settings and exposes the period command", () => {
    expect(getOpenAiChatGptOutagePeriod({ settingsJson: JSON.stringify({ year: 2026, month: 7 }) } as Integration)).toMatchObject({
      year: 2026,
      month: 7,
      label: "2026-07"
    });
    expect(openAiChatGptOutagesAdapter.supportsPeriod).toBe(true);
  });

  it("auto-discovers active monthly ChatGPT outage markets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "of-chatgpt-outage-days-in-may-2026",
              title: "# of ChatGPT Outage Days in May 2026?",
              active: true,
              closed: false,
              tags: [{ slug: "chatgpt" }, { slug: "outage" }]
            },
            {
              slug: "of-chatgpt-outage-days-in-june-2026",
              title: "# of ChatGPT Outage Days in June 2026?",
              active: true,
              closed: false,
              tags: [{ slug: "chatgpt" }, { slug: "outage" }]
            }
          ]
        })
      })
    );

    const result = await refreshOpenAiChatGptOutagePolymarketQueue(
      {
        settingsJson: null,
        polymarketUrl: "https://polymarket.com/event/of-chatgpt-outage-days-in-may-2026"
      } as Integration,
      new Date("2026-05-31T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      year?: number;
      month?: number;
      polymarketMarkets?: Array<{ slug: string }>;
    };

    expect(result.activeUrl).toBe("https://polymarket.com/event/of-chatgpt-outage-days-in-may-2026");
    expect(settings).toMatchObject({ year: 2026, month: 5 });
    expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual([
      "of-chatgpt-outage-days-in-may-2026",
      "of-chatgpt-outage-days-in-june-2026"
    ]);
  });
});
