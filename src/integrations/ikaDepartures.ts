import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, EventMonitorPost, EventMonitorResult, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.flightaware.com/live/airport/OIIE";
const defaultPolymarketUrl = "https://polymarket.com/event/any-departure-from-tehran-ika-byptptpt-20260607232607846";
const maxDepartures = 20;

export type IkaDeparture = {
  id: string;
  ident: string;
  aircraftType: string;
  destination: string;
  depart: string;
  arrive: string;
  url: string;
};

export function extractIkaDepartures(html: string): IkaDeparture[] {
  const $ = cheerio.load(html);
  const table = $('table.airportBoard[data-type="departures"]').first();
  if (!table.length) {
    throw new Error("Could not find FlightAware IKA Departures table");
  }

  const departures = table
    .find("tbody tr")
    .toArray()
    .map((row) => extractIkaDepartureFromRow($, row))
    .filter((departure): departure is IkaDeparture => departure !== null);

  return dedupeDepartures(departures);
}

export function formatIkaDepartureValue(departure: IkaDeparture): string {
  return [
    `Ident: ${departure.ident}`,
    `Type: ${departure.aircraftType || "unknown"}`,
    `To: ${departure.destination}`,
    `Depart: ${departure.depart}`,
    `Arrive: ${departure.arrive || "unknown"}`,
    `FlightAware: ${departure.url}`
  ].join("\n");
}

export function formatIkaDeparturesValue(departures: IkaDeparture[]): string {
  if (departures.length === 0) {
    return "No departures currently listed in FlightAware Departures (More).";
  }

  return departures.slice(0, maxDepartures).map(formatIkaDepartureValue).join("\n\n");
}

export const ikaDeparturesAdapter: WebsiteAdapter = {
  id: "ika-departures",
  commandName: "ika",
  displayName: "FlightAware IKA Departures",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "ika-departures",
  alertRoleName: "IKA Departure Alerts",
  alertRoleEmoji: "\uD83D\uDEEB",
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "Fixed 1-minute check for new FlightAware IKA departures",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const observedAt = new Date();
    const departures = await fetchIkaDepartures();
    const value = formatIkaDeparturesValue(departures);
    return {
      value,
      rawValue: value,
      unit: "FlightAware IKA departures",
      observedAt
    };
  },
  async fetchEventUpdates(): Promise<EventMonitorResult> {
    const observedAt = new Date();
    const posts = (await fetchIkaDepartures()).slice(0, maxDepartures).map((departure) => toEventPost(departure, observedAt));
    return {
      posts,
      strikeTerms: [],
      checkTitle: "Latest IKA departures",
      checkFields: [
        { name: "Departures scanned", value: String(posts.length), inline: true },
        { name: "Latest departure", value: posts[0]?.text ?? "none", inline: false },
        { name: "Latest source", value: posts[0]?.url ?? "none", inline: false }
      ],
      observedAt
    };
  }
};

async function fetchIkaDepartures(): Promise<IkaDeparture[]> {
  const response = await fetchWithTimeout(sourceUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1",
      accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(`FlightAware IKA page returned HTTP ${response.status}`);
  }

  return extractIkaDepartures(await response.text());
}

function extractIkaDepartureFromRow($: cheerio.CheerioAPI, row: Element): IkaDeparture | null {
  const cells = $(row).find("td");
  const flightLink = cells.eq(0).find('a[href*="/live/flight/"]').first();
  const ident = normalizeText(flightLink.text());
  const href = flightLink.attr("href");
  if (!ident || !href) {
    return null;
  }

  const url = new URL(href, sourceUrl).toString();
  return {
    id: getDepartureId(url),
    ident,
    aircraftType: normalizeText(cells.eq(1).text()),
    destination: normalizeText(cells.eq(2).text()),
    depart: normalizeText(cells.eq(3).text()),
    arrive: normalizeText(cells.eq(5).text()),
    url
  };
}

function toEventPost(departure: IkaDeparture, observedAt: Date): EventMonitorPost {
  return {
    id: departure.id,
    type: "FlightAware departure",
    alertTitle: "New IKA departure listed",
    sourceLabel: "FlightAware",
    buttonLabel: "Open flight",
    mentionAlertRole: true,
    textFieldName: "Departure",
    text: formatIkaDepartureValue(departure),
    qualifyingText: formatIkaDepartureValue(departure),
    postedAt: observedAt,
    url: departure.url,
    polymarketUrl: defaultPolymarketUrl,
    fields: [
      { name: "Ident", value: departure.ident, inline: true },
      { name: "To", value: departure.destination || "unknown", inline: true },
      { name: "Depart", value: departure.depart || "unknown", inline: true },
      { name: "Arrive", value: departure.arrive || "unknown", inline: true }
    ],
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

function dedupeDepartures(departures: IkaDeparture[]): IkaDeparture[] {
  const seen = new Set<string>();
  const deduped: IkaDeparture[] = [];
  for (const departure of departures) {
    if (seen.has(departure.id)) {
      continue;
    }

    seen.add(departure.id);
    deduped.push(departure);
  }
  return deduped;
}

function getDepartureId(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/\/+$/, "") || parsed.toString();
  } catch {
    return url;
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
