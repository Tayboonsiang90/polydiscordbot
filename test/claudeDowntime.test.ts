import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claudeDowntimeAdapter,
  claudeDowntimeShouldAlertOnChange,
  extractClaudeUptimeDaysFromHtml,
  filterNewClaudeDailyReportDay,
  filterNewClaudeDowntimeDays,
  findClaudeDowntimeDays,
  formatClaudeDowntimeMonitorValue,
  getClaudeDowntimePeriod,
  type ClaudeUptimeDay
} from "../src/integrations/claudeDowntime.js";
import type { Integration } from "../src/integrations/types.js";

const polymarketUrl = "https://polymarket.com/event/will-claude-go-down-on-days-in-june";

const sampleProps = {
  component: { name: "claude.ai" },
  months: [
    {
      name: "June",
      year: 2026,
      days: [
        {
          color: "#76ad2a",
          date: "2026-06-01T00:00:00.000Z",
          events: [],
          p: 0,
          m: 0
        },
        {
          color: "#f2872f",
          date: "2026-06-02T00:00:00.000Z",
          events: [{ name: "Elevated error rates" }],
          p: 3_600,
          m: 0
        },
        {
          color: "#76AD2A",
          date: "2026-06-03T00:00:00.000Z",
          events: [],
          p: 0,
          m: 0
        },
        { color: "#EAEAEA" }
      ]
    }
  ]
};

const sampleHtml = `<html><body><div data-react-class="UptimeCalendar" data-react-props='${JSON.stringify(sampleProps)}'></div></body></html>`;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Claude downtime adapter", () => {
  it("parses Claude Status uptime boxes and only finalizes days with a following non-grey day", () => {
    const days = extractClaudeUptimeDaysFromHtml(sampleHtml);

    expect(days).toEqual([
      expect.objectContaining({ date: "2026-06-01", color: "#76ad2a", finalized: true, downtime: false }),
      expect.objectContaining({
        date: "2026-06-02",
        color: "#f2872f",
        eventNames: ["Elevated error rates"],
        partialSeconds: 3_600,
        finalized: true,
        downtime: true
      }),
      expect.objectContaining({ date: "2026-06-03", color: "#76ad2a", finalized: false, downtime: false })
    ]);
  });

  it("selects the claude.ai calendar when other Claude components are present", () => {
    const otherProps = {
      component: { name: "Console" },
      months: [{ days: [{ color: "#f2872f", date: "2026-06-01T00:00:00.000Z" }] }]
    };
    const html = [
      `<div data-react-class="UptimeCalendar" data-react-props='${JSON.stringify(otherProps)}'></div>`,
      `<div data-react-class="UptimeCalendar" data-react-props='${JSON.stringify(sampleProps)}'></div>`
    ].join("");

    expect(extractClaudeUptimeDaysFromHtml(html).map((day) => day.date)).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03"
    ]);
  });

  it("filters downtime days for the configured month", () => {
    const result = findClaudeDowntimeDays(extractClaudeUptimeDaysFromHtml(sampleHtml), {
      year: 2026,
      month: 6,
      label: "2026-06"
    });

    expect(result.allDays).toHaveLength(3);
    expect(result.finalizedDays.map((day) => day.date)).toEqual(["2026-06-01", "2026-06-02"]);
    expect(result.downtimeDays.map((day) => day.date)).toEqual(["2026-06-02"]);
  });

  it("stores alerted downtime dates so repeated checks do not re-alert the same day", () => {
    const downtimeDays = findClaudeDowntimeDays(extractClaudeUptimeDaysFromHtml(sampleHtml), {
      year: 2026,
      month: 6,
      label: "2026-06"
    }).downtimeDays;
    const first = filterNewClaudeDowntimeDays(null, polymarketUrl, downtimeDays);
    const storedValue = formatClaudeDowntimeMonitorValue({
      period: { year: 2026, month: 6, label: "2026-06" },
      allDays: [],
      finalizedDays: [],
      newDailyReportDay: null,
      reportedDailyDates: [],
      downtimeDays,
      newDowntimeDays: first.newDowntimeDays,
      alertedDowntimeDates: first.alertedDowntimeDates,
      sourceUrl: claudeDowntimeAdapter.sourceUrl,
      polymarketUrl
    });
    const second = filterNewClaudeDowntimeDays(storedValue, polymarketUrl, downtimeDays);

    expect(first.newDowntimeDays.map((day) => day.date)).toEqual(["2026-06-02"]);
    expect(first.alertedDowntimeDates).toEqual(["2026-06-02"]);
    expect(second.newDowntimeDays).toEqual([]);
    expect(second.alertedDowntimeDates).toEqual(["2026-06-02"]);
  });

  it("alerts only when the formatted value contains new downtime days", () => {
    const downtimeDay: ClaudeUptimeDay = {
      date: "2026-06-02",
      color: "#f2872f",
      eventNames: ["Elevated error rates"],
      partialSeconds: 3_600,
      maintenanceSeconds: 0,
      finalized: true,
      downtime: true
    };
    const currentValue = formatClaudeDowntimeMonitorValue({
      period: { year: 2026, month: 6, label: "2026-06" },
      allDays: [downtimeDay],
      finalizedDays: [downtimeDay],
      newDailyReportDay: null,
      reportedDailyDates: [],
      downtimeDays: [downtimeDay],
      newDowntimeDays: [downtimeDay],
      alertedDowntimeDates: ["2026-06-02"],
      sourceUrl: claudeDowntimeAdapter.sourceUrl,
      polymarketUrl
    });
    const quietValue = currentValue.replace(
      "New Downtime Days:\n2026-06-02 color #f2872f (non-green) partial 1.0h events: Elevated error rates",
      "New Downtime Days:\nnone"
    );

    expect(claudeDowntimeShouldAlertOnChange(null, currentValue)).toBe(true);
    expect(claudeDowntimeShouldAlertOnChange(currentValue, quietValue)).toBe(false);
  });

  it("alerts once for the latest finalized daily report even when it is green", () => {
    const days = findClaudeDowntimeDays(extractClaudeUptimeDaysFromHtml(sampleHtml), {
      year: 2026,
      month: 6,
      label: "2026-06"
    }).finalizedDays;
    const first = filterNewClaudeDailyReportDay(null, days);
    const storedValue = formatClaudeDowntimeMonitorValue({
      period: { year: 2026, month: 6, label: "2026-06" },
      allDays: [],
      finalizedDays: days,
      newDailyReportDay: first.newDailyReportDay,
      reportedDailyDates: first.reportedDailyDates,
      downtimeDays: [],
      newDowntimeDays: [],
      alertedDowntimeDates: [],
      sourceUrl: claudeDowntimeAdapter.sourceUrl,
      polymarketUrl
    });
    const second = filterNewClaudeDailyReportDay(storedValue, days);
    const quietValue = formatClaudeDowntimeMonitorValue({
      period: { year: 2026, month: 6, label: "2026-06" },
      allDays: [],
      finalizedDays: days,
      newDailyReportDay: second.newDailyReportDay,
      reportedDailyDates: second.reportedDailyDates,
      downtimeDays: [],
      newDowntimeDays: [],
      alertedDowntimeDates: [],
      sourceUrl: claudeDowntimeAdapter.sourceUrl,
      polymarketUrl
    });

    expect(first.newDailyReportDay?.date).toBe("2026-06-02");
    expect(first.reportedDailyDates).toEqual(["2026-06-02"]);
    expect(claudeDowntimeShouldAlertOnChange(null, storedValue)).toBe(true);
    expect(second.newDailyReportDay).toBeNull();
    expect(second.reportedDailyDates).toEqual(["2026-06-02"]);
    expect(claudeDowntimeShouldAlertOnChange(storedValue, quietValue)).toBe(false);
  });

  it("derives the period from settings before falling back to the Polymarket URL", () => {
    const integration = {
      settingsJson: JSON.stringify({ year: 2026, month: 5 }),
      polymarketUrl
    } as Integration;

    expect(getClaudeDowntimePeriod(integration)).toEqual({ year: 2026, month: 5, label: "2026-05" });
    expect(
      getClaudeDowntimePeriod(
        {
          settingsJson: null,
          polymarketUrl: "https://polymarket.com/event/will-claude-go-down-on-days-in-april"
        } as Integration,
        new Date("2026-05-29T12:00:00.000Z")
      )
    ).toEqual({ year: 2026, month: 4, label: "2026-04" });
  });

  it("auto-discovers current titles that include the day-count blank", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "will-claude-go-down-on-days-in-august-20260728182414700",
              title: "Will Claude go down on __ days in August?",
              active: true,
              closed: false
            }
          ]
        })
      })
    );

    const settingsJson = await claudeDowntimeAdapter.refreshSettings?.({
      settingsJson: null,
      polymarketUrl
    } as Integration);
    const settings = JSON.parse(settingsJson ?? "{}") as {
      year?: number;
      month?: number;
      polymarketMarkets?: Array<{ slug: string }>;
    };

    expect(settings).toMatchObject({ year: 2026, month: 7 });
    expect(settings.polymarketMarkets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "will-claude-go-down-on-days-in-august-20260728182414700"
        })
      ])
    );
  });

  it("uses fixed hourly polling with month/year support", () => {
    expect(claudeDowntimeAdapter.supportsPeriod).toBe(true);
    expect(claudeDowntimeAdapter.getPollIntervalMinutes?.({} as never)).toBe(60);
    expect(claudeDowntimeAdapter.getPollIntervalReason?.({} as never)).toContain("hourly");
  });
});
