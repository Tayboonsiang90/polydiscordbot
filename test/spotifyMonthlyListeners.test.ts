import { describe, expect, it } from "vitest";
import {
  extractSpotifyMonthlyListenersFromHtml,
  formatSpotifyMonthlyListenersValue,
  parseSpotifyMonthlyListenerStrikes,
  spotifyBieberMonthlyListenersAdapter
} from "../src/integrations/spotifyMonthlyListeners.js";

describe("Spotify monthly listeners adapter", () => {
  it("extracts monthly listeners from Spotify artist metadata", () => {
    expect(
      extractSpotifyMonthlyListenersFromHtml(
        '<meta property="og:description" content="Artist · 125.4M monthly listeners."/>'
      )
    ).toEqual({
      listeners: 125_400_000,
      displayText: "125.4M",
      description: "Artist · 125.4M monthly listeners."
    });
  });

  it("parses open listener strikes from Gamma markets", () => {
    expect(
      parseSpotifyMonthlyListenerStrikes([
        {
          question: "Will Justin Bieber's monthly listeners figure hit 160m by August 31?",
          slug: "will-justin-biebers-monthly-listeners-figure-hit-160m-by-august-31",
          active: true,
          closed: false,
          outcomePrices: '["0.31","0.69"]'
        },
        {
          question: "Will Justin Bieber's monthly listeners figure hit 130m by August 31?",
          slug: "will-justin-biebers-monthly-listeners-figure-hit-130m-by-august-31",
          active: true,
          closed: false,
          outcomePrices: '["0.84","0.16"]'
        },
        {
          question: "Will Justin Bieber's monthly listeners figure hit 120m by August 31?",
          slug: "will-justin-biebers-monthly-listeners-figure-hit-120m-by-august-31",
          active: true,
          closed: true,
          outcomePrices: '["1","0"]'
        }
      ])
    ).toMatchObject([
      { label: "130M", listeners: 130_000_000 },
      { label: "160M", listeners: 160_000_000 }
    ]);
  });

  it("formats hit and open monthly listener strikes", () => {
    expect(
      formatSpotifyMonthlyListenersValue(
        125_400_000,
        "125.4M",
        "Artist · 125.4M monthly listeners.",
        [
          {
            label: "120M",
            listeners: 120_000_000,
            question: "120m",
            slug: "120m"
          },
          {
            label: "130M",
            listeners: 130_000_000,
            question: "130m",
            slug: "130m"
          }
        ],
        "https://polymarket.com/event/justin-bieber-monthly-listeners-hits-by-august-31-20260710220109217"
      )
    ).toContain("Next strike: 130M - 4,600,000 away");
  });

  it("alerts only when the monthly listener line changes", () => {
    const previous = "Monthly listeners: 125,400,000 (125.4M)";
    const same = "Monthly listeners: 125,400,000 (125.4M)\nParsed strikes: 130M";
    const changed = "Monthly listeners: 126,000,000 (126M)";

    expect(spotifyBieberMonthlyListenersAdapter.shouldAlertOnChange?.(previous, same)).toBe(false);
    expect(spotifyBieberMonthlyListenersAdapter.shouldAlertOnChange?.(previous, changed)).toBe(true);
  });
});
