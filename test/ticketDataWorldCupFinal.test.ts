import { describe, expect, it } from "vitest";
import {
  extractTicketDataWorldCupSnapshot,
  formatTicketDataWorldCupValue,
  getTicketDataPollIntervalMinutes,
  getTicketPriceBracket,
  shouldAlertOnTicketDataWorldCupChange
} from "../src/integrations/ticketDataWorldCupFinal.js";

describe("TicketData World Cup Final adapter", () => {
  it("parses the rendered TicketData current get-in price", () => {
    const snapshot = extractTicketDataWorldCupSnapshot(
      [
        "Title: [M104] Spain v Argentina (Final - World Cup) Tickets | Price History & Forecasts",
        "Markdown Content:",
        "Current Get-In Price",
        "",
        "$9614",
        "",
        "per ticket (including fees)",
        "For the cheapest pair of tickets Checked 39 seconds ago"
      ].join("\n"),
      "TicketData via r.jina.ai reader"
    );

    expect(snapshot.currentGetInPrice).toBe(9614);
    expect(snapshot.finalGetInPrice).toBeNull();
    expect(snapshot.marketBracket).toBe(">= $9,000");
    expect(snapshot.finalStatus).toBe("not final yet");
  });

  it("parses final get-in price and applies exact boundary to the higher bracket", () => {
    const snapshot = extractTicketDataWorldCupSnapshot(
      "Final Get-In Price\n\n$6,500\n\nper ticket (including fees)",
      "TicketData direct"
    );

    expect(snapshot.finalGetInPrice).toBe(6500);
    expect(snapshot.marketBracket).toBe("$6,500-$7,000");
    expect(snapshot.finalStatus).toBe("final");
  });

  it("parses final-state TicketData pages like event 89460960", () => {
    const snapshot = extractTicketDataWorldCupSnapshot(
      [
        "Title: San Antonio Spurs at New York Knicks (NBA Finals Game 4 New York Home Game 2) Tickets | Price History & Forecasts",
        "URL Source: https://www.ticketdata.com/events/89460960",
        "Markdown Content:",
        "Final Get-In Price",
        "",
        "$3406",
        "",
        "per ticket (including fees)",
        "",
        "For the cheapest pair of tickets",
        "",
        "Final 3 Day Price Change",
        "",
        "66%",
        "",
        "Get-In Price fell from $10018 to $3406 over the final 3 days before the event"
      ].join("\n"),
      "TicketData via r.jina.ai reader"
    );

    expect(snapshot.eventTitle).toBe(
      "San Antonio Spurs at New York Knicks (NBA Finals Game 4 New York Home Game 2) Tickets | Price History & Forecasts"
    );
    expect(snapshot.finalGetInPrice).toBe(3406);
    expect(snapshot.currentGetInPrice).toBeNull();
    expect(snapshot.marketBracket).toBe("< $6,000");
    expect(snapshot.finalStatus).toBe("final");
    expect(formatTicketDataWorldCupValue(snapshot)).toContain("Final price published: yes");
  });

  it("maps ticket price brackets", () => {
    expect(getTicketPriceBracket(5999)).toBe("< $6,000");
    expect(getTicketPriceBracket(6000)).toBe("$6,000-$6,500");
    expect(getTicketPriceBracket(7000)).toBe("$7,000-$7,500");
    expect(getTicketPriceBracket(9000)).toBe(">= $9,000");
  });

  it("alerts on bracket crossings or final price publication only", () => {
    const previous = formatTicketDataWorldCupValue({
      eventTitle: "Final",
      finalGetInPrice: null,
      currentGetInPrice: 7100,
      marketBracket: "$7,000-$7,500",
      finalStatus: "not final yet",
      sourceStatus: "TicketData via r.jina.ai reader"
    });
    const sameBracket = formatTicketDataWorldCupValue({
      eventTitle: "Final",
      finalGetInPrice: null,
      currentGetInPrice: 7200,
      marketBracket: "$7,000-$7,500",
      finalStatus: "not final yet",
      sourceStatus: "TicketData via r.jina.ai reader"
    });
    const nextBracket = formatTicketDataWorldCupValue({
      eventTitle: "Final",
      finalGetInPrice: null,
      currentGetInPrice: 7600,
      marketBracket: "$7,500-$8,000",
      finalStatus: "not final yet",
      sourceStatus: "TicketData via r.jina.ai reader"
    });
    const final = formatTicketDataWorldCupValue({
      eventTitle: "Final",
      finalGetInPrice: 7600,
      currentGetInPrice: 7600,
      marketBracket: "$7,500-$8,000",
      finalStatus: "final",
      sourceStatus: "TicketData via r.jina.ai reader"
    });

    expect(shouldAlertOnTicketDataWorldCupChange(null, previous)).toBe(false);
    expect(shouldAlertOnTicketDataWorldCupChange(previous, sameBracket)).toBe(false);
    expect(shouldAlertOnTicketDataWorldCupChange(previous, nextBracket)).toBe(true);
    expect(shouldAlertOnTicketDataWorldCupChange(nextBracket, final)).toBe(true);
    expect(shouldAlertOnTicketDataWorldCupChange(previous, final)).toBe(true);
  });

  it("polls every minute during the final-price window", () => {
    expect(getTicketDataPollIntervalMinutes(new Date("2026-07-17T12:00:00.000Z"))).toBe(60);
    expect(getTicketDataPollIntervalMinutes(new Date("2026-07-19T19:00:00.000Z"))).toBe(1);
    expect(getTicketDataPollIntervalMinutes(new Date("2026-08-01T04:00:00.000Z"))).toBe(60);
  });
});
