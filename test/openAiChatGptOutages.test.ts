import { describe, expect, it } from "vitest";
import {
  extractOpenAiChatGptComponentsFromStatusHtml,
  extractOpenAiIncidentComponentImpacts,
  formatOpenAiChatGptOutageValue,
  getOpenAiChatGptOutagePeriod,
  getOpenAiChatGptQualifyingOutages,
  openAiChatGptOutagesAdapter,
  openAiChatGptOutagesShouldAlertOnChange
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

  it("uses month/year settings and exposes the period command", () => {
    expect(getOpenAiChatGptOutagePeriod({ settingsJson: JSON.stringify({ year: 2026, month: 7 }) } as Integration)).toMatchObject({
      year: 2026,
      month: 7,
      label: "2026-07"
    });
    expect(openAiChatGptOutagesAdapter.supportsPeriod).toBe(true);
  });
});
