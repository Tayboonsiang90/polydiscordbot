import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractLatestPbocAnnouncement,
  extractLatestPbocAnnouncementValue,
  extractPbocAnnouncementDetail,
  fetchPbocUrl,
  formatPbocAnnouncementValue,
  pbocRateChangeShouldAlertOnChange,
  pbocRateChangeAdapter,
  refreshPbocRateChangePolymarketQueue
} from "../src/integrations/pbocRateChange.js";
import type { Integration } from "../src/integrations/types.js";

const listHtml = `
  <ul>
    <li><span>2026-06-02</span><a href="/en/3688110/3688181/2026060214124728650/index.html">Announcement on Open Market Operations No.104 [2026]</a></li>
    <li><span>2026-05-22</span><a href="/en/3688110/3688181/2026052215425291145/index.html">Announcement on Central Bank Bill Issuance No.3 [2026]</a></li>
    <li><span>2026-05-20</span><a href="/en/3688110/3688181/2026052010000000000/index.html">Unrelated administrative notice</a></li>
  </ul>
`;

const detailHtml = `
  <div class="content">
    Announcement on Open Market Operations No.104 [2026]
    (Open Market Operations Office, June 2, 2026)
    The People’s Bank of China conducted 7-day reverse repo operations in the amount of RMB200 million through quantity bidding at a fixed interest rate on June 2, 2026, fully meeting the demand of primary dealers.
    Details of the Reverse Repo Operations Maturity Rate Bidding Volume Winning Bid Volume 7 days 1.40% RMB200 million RMB200 million
  </div>
`;

describe("PBoC rate change adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("extracts the latest rate-relevant announcement row", () => {
    expect(extractLatestPbocAnnouncement(listHtml)).toEqual({
      title: "Announcement on Open Market Operations No.104 [2026]",
      date: "2026-06-02",
      url: "https://www.pbc.gov.cn/en/3688110/3688181/2026060214124728650/index.html"
    });
  });

  it("extracts announcement detail rates and summary", () => {
    expect(extractPbocAnnouncementDetail(detailHtml)).toEqual({
      rates: ["1.40%"],
      summary:
        "The People’s Bank of China conducted 7-day reverse repo operations in the amount of RMB200 million through quantity bidding at a fixed interest rate on June 2, 2026, fully meeting the demand of primary dealers."
    });
  });

  it("formats a stable monitor value", () => {
    const value = extractLatestPbocAnnouncementValue(listHtml, extractPbocAnnouncementDetail(detailHtml));
    expect(value).toContain("Title: Announcement on Open Market Operations No.104 [2026]");
    expect(value).toContain("Date: 2026-06-02");
    expect(value).toContain("Rate(s): 1.40%");
    expect(value).toContain("URL: https://www.pbc.gov.cn/en/3688110/3688181/2026060214124728650/index.html");
  });

  it("alerts only when extracted rates change", () => {
    const previousValue = formatPbocAnnouncementValue(
      { title: "Announcement on Open Market Operations No.103 [2026]", date: "2026-06-01", url: "https://example.com/103" },
      { rates: ["1.40%"], summary: "previous" }
    );
    const sameRateValue = formatPbocAnnouncementValue(
      { title: "Announcement on Open Market Operations No.104 [2026]", date: "2026-06-02", url: "https://example.com/104" },
      { rates: ["1.40%"], summary: "current" }
    );
    const changedRateValue = formatPbocAnnouncementValue(
      { title: "Announcement on Open Market Operations No.105 [2026]", date: "2026-06-03", url: "https://example.com/105" },
      { rates: ["1.30%"], summary: "changed" }
    );

    expect(pbocRateChangeShouldAlertOnChange(previousValue, sameRateValue)).toBe(false);
    expect(pbocRateChangeShouldAlertOnChange(previousValue, changedRateValue)).toBe(true);
  });

  it("throws when no rate-relevant announcement row is present", () => {
    expect(() => extractLatestPbocAnnouncement("<html></html>")).toThrow("Could not find the latest PBoC rate-relevant announcement row");
  });

  it("adds a PBoC-level retry after temporary DNS failures", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("getaddrinfo EAI_AGAIN www.pbc.gov.cn"), { code: "EAI_AGAIN" }))
      .mockRejectedValueOnce(Object.assign(new Error("getaddrinfo EAI_AGAIN www.pbc.gov.cn"), { code: "EAI_AGAIN" }))
      .mockRejectedValueOnce(Object.assign(new Error("getaddrinfo EAI_AGAIN www.pbc.gov.cn"), { code: "EAI_AGAIN" }))
      .mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const assertion = expect(fetchPbocUrl("https://www.pbc.gov.cn/en/3688110/3688181/index.html", [0])).resolves.toMatchObject({
      ok: true
    });
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("adds a PBoC-level retry after temporary connect timeouts", async () => {
    vi.useFakeTimers();
    const timeoutError = Object.assign(new Error("fetch failed"), {
      cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" })
    });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(timeoutError)
      .mockRejectedValueOnce(timeoutError)
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const assertion = expect(fetchPbocUrl("https://www.pbc.gov.cn/en/3688110/3688181/index.html", [0])).resolves.toMatchObject({
      ok: true
    });
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("uses and discovers the active PBoC decision market", async () => {
    expect(pbocRateChangeAdapter.defaultPolymarketUrl).toContain("peoples-bank-of-china-rate-change-by-september-30");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            events: [
              {
                slug: "peoples-bank-of-china-rate-change-by-september-30-20260630000252021",
                title: "People's Bank of China rate change by September 30?",
                active: true,
                closed: false,
                startDate: "2026-06-30T04:00:00Z",
                endDate: "2026-10-01T03:59:00Z"
              }
            ]
          }),
          { status: 200 }
        )
      )
    );

    const result = await refreshPbocRateChangePolymarketQueue(buildIntegration(), new Date("2026-07-31T12:00:00Z"));
    expect(result.activeUrl).toContain("peoples-bank-of-china-rate-change-by-september-30");
  });
});

function buildIntegration(): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "pboc-rate-change",
    displayName: "PBoC Rate Change",
    sourceUrl: "https://www.pbc.gov.cn/en/3688110/3688181/index.html",
    polymarketUrl: null,
    alertRoleId: null,
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: null,
    settingsJson: null,
    pollIntervalMinutes: 15,
    status: "active",
    lastValue: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    snapshotValue: null,
    snapshotCheckedAt: null,
    snapshotDate: null,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z"
  };
}
