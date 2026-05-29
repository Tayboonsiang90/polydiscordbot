import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { parsePolymarketMonthWindow } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import { refreshMonthlyPolymarketQueue, type MonthlyPolymarketDiscoveryConfig } from "./monthlyPolymarketDiscovery.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://status.claude.com/uptime/";
const defaultPolymarketUrl = "https://polymarket.com/event/will-claude-go-down-on-days-in-june";
const defaultYear = 2026;
const defaultMonth = 6;
const greenColor = "#76ad2a";
const futureGreyColors = new Set(["#eaeaea", "#b0aea5"]);
const monthlyDiscoveryConfig: MonthlyPolymarketDiscoveryConfig = {
  searchQuery: "will claude go down on days in",
  slugPrefix: "will-claude-go-down-on-days-in-",
  titlePrefix: "Will Claude go down on days in",
  lastDiscoveryAtKey: "lastClaudeDowntimeDiscoveryAt",
  activeIntervalMs: 2 * 60 * 60_000,
  noActiveIntervalMs: 30 * 60_000,
  lookaheadMs: 21 * 24 * 60 * 60_000
};

export type ClaudeDowntimePeriod = {
  year: number;
  month: number;
  label: string;
};

export type ClaudeUptimeDay = {
  date: string;
  color: string;
  eventNames: string[];
  partialSeconds: number | null;
  maintenanceSeconds: number | null;
  finalized: boolean;
  downtime: boolean;
};

type ClaudeUptimeCalendarProps = {
  component?: {
    name?: unknown;
  };
  months?: Array<{
    days?: unknown[];
  }>;
};

type RawClaudeUptimeDay = {
  date: string;
  color: string;
  eventNames: string[];
  partialSeconds: number | null;
  maintenanceSeconds: number | null;
};

export const claudeDowntimeAdapter: WebsiteAdapter = {
  id: "claude-downtime",
  commandName: "claudedown",
  displayName: "Claude Downtime Days",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "claudedown",
  alertRoleName: "Claude Downtime Alerts",
  alertRoleEmoji: "\uD83D\uDD34",
  defaultSettings: { year: defaultYear, month: defaultMonth },
  supportsPeriod: true,
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Fixed hourly check for finalized claude.ai uptime colors",
  shouldAlertOnChange: claudeDowntimeShouldAlertOnChange,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshMonthlyPolymarketQueue(integration, monthlyDiscoveryConfig)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const observedAt = new Date();
    const period = getClaudeDowntimePeriod(integration);
    const polymarketUrl = integration?.polymarketUrl ?? defaultPolymarketUrl;
    const response = await fetchWithTimeout(sourceUrl, {
      headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
    });
    if (!response.ok) {
      throw new Error(`Claude Status returned HTTP ${response.status}`);
    }

    const days = findClaudeDowntimeDays(extractClaudeUptimeDaysFromHtml(await response.text()), period);
    const alertState = filterNewClaudeDowntimeDays(integration?.lastValue ?? null, polymarketUrl, days.downtimeDays);
    const value = formatClaudeDowntimeMonitorValue({
      period,
      allDays: days.allDays,
      finalizedDays: days.finalizedDays,
      downtimeDays: days.downtimeDays,
      newDowntimeDays: alertState.newDowntimeDays,
      alertedDowntimeDates: alertState.alertedDowntimeDates,
      sourceUrl,
      polymarketUrl
    });

    return {
      value,
      rawValue: String(days.downtimeDays.length),
      unit: "downtime days",
      observedAt
    };
  }
};

export function extractClaudeUptimeDaysFromHtml(html: string): ClaudeUptimeDay[] {
  const $ = cheerio.load(html);
  const rawProps = $('[data-react-class="UptimeCalendar"]')
    .map((_, element) => $(element).attr("data-react-props"))
    .get()
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (!rawProps.length) {
    throw new Error("Could not find Claude Status uptime calendar data");
  }

  let fallbackProps: ClaudeUptimeCalendarProps | null = null;
  for (const raw of rawProps) {
    const props = JSON.parse(raw) as ClaudeUptimeCalendarProps;
    const componentName = typeof props.component?.name === "string" ? props.component.name.trim().toLowerCase() : "";
    if (componentName === "claude.ai") {
      return normalizeClaudeUptimeDays(props);
    }
    if (!componentName && !fallbackProps) {
      fallbackProps = props;
    }
  }

  if (fallbackProps) {
    return normalizeClaudeUptimeDays(fallbackProps);
  }

  throw new Error("Could not find claude.ai uptime calendar data");
}

export function normalizeClaudeUptimeDays(props: ClaudeUptimeCalendarProps): ClaudeUptimeDay[] {
  const rawDays = (props.months ?? [])
    .flatMap((month) => month.days ?? [])
    .map(normalizeRawClaudeUptimeDay)
    .filter((day): day is RawClaudeUptimeDay => day !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
  const dayByDate = new Map(rawDays.map((day) => [day.date, day]));

  return rawDays.map((day) => {
    const nextDay = dayByDate.get(addDays(day.date, 1));
    const finalized = Boolean(nextDay && !isFutureGreyColor(nextDay.color));
    return {
      ...day,
      finalized,
      downtime: finalized && !isGreenColor(day.color)
    };
  });
}

export function findClaudeDowntimeDays(
  days: ClaudeUptimeDay[],
  period: ClaudeDowntimePeriod
): {
  allDays: ClaudeUptimeDay[];
  finalizedDays: ClaudeUptimeDay[];
  downtimeDays: ClaudeUptimeDay[];
} {
  const allDays = days.filter((day) => isInPeriod(day.date, period));
  const finalizedDays = allDays.filter((day) => day.finalized);
  const downtimeDays = finalizedDays.filter((day) => day.downtime);
  return { allDays, finalizedDays, downtimeDays };
}

export function filterNewClaudeDowntimeDays(
  previousValue: string | null,
  polymarketUrl: string,
  downtimeDays: ClaudeUptimeDay[]
): { newDowntimeDays: ClaudeUptimeDay[]; alertedDowntimeDates: string[] } {
  const alertedDates = parseStoredAlertedDowntimeDates(previousValue, polymarketUrl);
  const newDowntimeDays = downtimeDays.filter((day) => !alertedDates.has(day.date));
  for (const day of newDowntimeDays) {
    alertedDates.add(day.date);
  }

  return {
    newDowntimeDays,
    alertedDowntimeDates: [...alertedDates].sort()
  };
}

export function formatClaudeDowntimeMonitorValue(input: {
  period: ClaudeDowntimePeriod;
  allDays: ClaudeUptimeDay[];
  finalizedDays: ClaudeUptimeDay[];
  downtimeDays: ClaudeUptimeDay[];
  newDowntimeDays: ClaudeUptimeDay[];
  alertedDowntimeDates: string[];
  sourceUrl: string;
  polymarketUrl: string;
}): string {
  const latestFinalized = input.finalizedDays.at(-1) ?? null;

  return [
    "Metric: Claude claude.ai downtime days",
    `Period: ${input.period.label}`,
    `Status boxes found: ${input.allDays.length}`,
    `Finalized days: ${input.finalizedDays.length}`,
    `Downtime days: ${input.downtimeDays.length}`,
    `Latest finalized day: ${latestFinalized ? formatClaudeUptimeDay(latestFinalized) : "none"}`,
    "New Downtime Days:",
    input.newDowntimeDays.length ? input.newDowntimeDays.map(formatClaudeUptimeDay).join("\n") : "none",
    "Alerted Downtime Days:",
    input.alertedDowntimeDates.length ? input.alertedDowntimeDates.join(", ") : "none",
    "Downtime Days:",
    input.downtimeDays.length ? input.downtimeDays.map(formatClaudeUptimeDay).join("\n") : "none",
    `Resolution: ${input.sourceUrl}`,
    `Alerted For: ${input.polymarketUrl}`
  ].join("\n");
}

export function claudeDowntimeShouldAlertOnChange(_previousValue: string | null, currentValue: string): boolean {
  const section = extractStoredSection(currentValue, "New Downtime Days", "Alerted Downtime Days");
  return Boolean(section && section.trim() !== "none");
}

export function getClaudeDowntimePeriod(integration?: Integration, now = new Date()): ClaudeDowntimePeriod {
  const settings = parseSettingsJson(integration?.settingsJson);
  const year = Number(settings.year);
  const month = Number(settings.month);
  if (isValidClaudeDowntimePeriod(year, month)) {
    return { year, month, label: `${year}-${padMonth(month)}` };
  }

  const polymarketUrl = integration?.polymarketUrl ?? defaultPolymarketUrl;
  const monthWindow = parsePolymarketMonthWindow(polymarketUrl, now);
  if (monthWindow) {
    return {
      year: monthWindow.year,
      month: monthWindow.month,
      label: `${monthWindow.year}-${padMonth(monthWindow.month)}`
    };
  }

  return { year: defaultYear, month: defaultMonth, label: `${defaultYear}-${padMonth(defaultMonth)}` };
}

function normalizeRawClaudeUptimeDay(value: unknown): RawClaudeUptimeDay | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const date = normalizeDate(record.date);
  const color = normalizeColor(record.color);
  if (!date || !color) {
    return null;
  }

  return {
    date,
    color,
    eventNames: normalizeEventNames(record.events),
    partialSeconds: normalizeNumber(record.p),
    maintenanceSeconds: normalizeNumber(record.m)
  };
}

function normalizeEventNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((event) => {
      if (!event || typeof event !== "object") {
        return [];
      }

      const name = (event as Record<string, unknown>).name;
      return typeof name === "string" && name.trim() ? [normalizeText(name)] : [];
    })
    .filter((name, index, names) => names.indexOf(name) === index);
}

function formatClaudeUptimeDay(day: ClaudeUptimeDay): string {
  const status = isGreenColor(day.color) ? "green" : "non-green";
  const partial = day.partialSeconds !== null ? ` partial ${formatDuration(day.partialSeconds)}` : "";
  const maintenance = day.maintenanceSeconds ? ` maintenance ${formatDuration(day.maintenanceSeconds)}` : "";
  const events = day.eventNames.length ? ` events: ${day.eventNames.slice(0, 2).join("; ")}` : "";
  return `${day.date} color ${day.color} (${status})${partial}${maintenance}${events}`;
}

function parseStoredAlertedDowntimeDates(previousValue: string | null, polymarketUrl: string): Set<string> {
  if (!previousValue?.includes(`Alerted For: ${polymarketUrl}`)) {
    return new Set();
  }

  const section = extractStoredSection(previousValue, "Alerted Downtime Days", "Downtime Days");
  const dates = [...(section ?? "").matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((match) => match[0]);
  return new Set(dates);
}

function extractStoredSection(value: string | null, heading: string, nextHeading: string): string | null {
  if (!value) {
    return null;
  }

  const startToken = `${heading}:\n`;
  const start = value.indexOf(startToken);
  if (start === -1) {
    return null;
  }

  const afterStart = start + startToken.length;
  const next = value.indexOf(`\n${nextHeading}:`, afterStart);
  return (next === -1 ? value.slice(afterStart) : value.slice(afterStart, next)).trim();
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function normalizeNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isGreenColor(color: string): boolean {
  return normalizeColor(color) === greenColor;
}

function isFutureGreyColor(color: string): boolean {
  const normalized = normalizeColor(color);
  return Boolean(normalized && futureGreyColors.has(normalized));
}

function isInPeriod(date: string, period: ClaudeDowntimePeriod): boolean {
  return date.startsWith(`${period.year}-${padMonth(period.month)}-`);
}

function isValidClaudeDowntimePeriod(year: number, month: number): boolean {
  return Number.isInteger(year) && Number.isInteger(month) && year >= 2026 && year <= 2100 && month >= 1 && month <= 12;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function padMonth(month: number): string {
  return String(month).padStart(2, "0");
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  return `${(minutes / 60).toFixed(1)}h`;
}
