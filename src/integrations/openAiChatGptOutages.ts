import { fetchWithTimeout } from "../http.js";
import { parseManualEasternDateTime } from "../marketEnd.js";
import { parsePolymarketMonthWindow } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import { refreshMonthlyPolymarketQueue, type MonthlyPolymarketDiscoveryConfig } from "./monthlyPolymarketDiscovery.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://status.openai.com/";
const incidentsApiUrl = "https://status.openai.com/api/v2/incidents.json";
const historyUrl = "https://status.openai.com/history";
const defaultPolymarketUrl = "https://polymarket.com/event/of-chatgpt-outage-days-in-june-2026";
const defaultYear = 2026;
const defaultMonth = 6;
const easternTimeZone = "America/New_York";
const qualifyingComponentStatuses = new Set(["partial_outage", "full_outage"]);
const monthlyDiscoveryConfig: MonthlyPolymarketDiscoveryConfig = {
  searchQuery: "chatgpt outage days",
  slugPrefix: "of-chatgpt-outage-days-in-",
  titlePrefix: "# of ChatGPT Outage Days in",
  lastDiscoveryAtKey: "lastChatGptOutageDiscoveryAt",
  requiredTagSlugs: ["chatgpt", "outage"]
};

export type OpenAiChatGptOutageSettings = {
  year: number;
  month: number;
};

export type OpenAiStatusIncident = {
  id?: string;
  name?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  resolved_at?: string | null;
};

export type OpenAiStatusIncidentsResponse = {
  incidents?: OpenAiStatusIncident[];
};

export type OpenAiStatusComponent = {
  id: string;
  name: string;
};

export type OpenAiIncidentComponentImpact = {
  componentId: string;
  startAt: string;
  endAt: string;
  status: string;
  incidentId: string;
};

export type OpenAiChatGptOutageIncident = {
  id: string;
  name: string;
  resolvedAt: string;
  url: string;
  componentNames: string[];
  componentStatuses: string[];
  outageDatesEt: string[];
};

export type OpenAiReviewOutageIncident = OpenAiChatGptOutageIncident & {
  isChatGptAffected: boolean;
};

type OpenAiOutagePeriod = OpenAiChatGptOutageSettings & {
  label: string;
  startAt: Date;
  endAt: Date;
};

type OpenAiDailyReportState = {
  newDailyReportDay: string | null;
  reportedDailyDates: string[];
};

export const openAiChatGptOutagesAdapter: WebsiteAdapter = {
  id: "openai-chatgpt-outages",
  commandName: "chatgptoutage",
  displayName: "ChatGPT Outage Days",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "chatgptoutage",
  alertRoleName: "ChatGPT Outage Alerts",
  alertRoleEmoji: "\uD83D\uDFE0",
  defaultSettings: { year: defaultYear, month: defaultMonth },
  supportsPeriod: true,
  shouldAlertOnChange: openAiChatGptOutagesShouldAlertOnChange,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshOpenAiChatGptOutagePolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const observedAt = new Date();
    const period = getOpenAiChatGptOutagePeriod(integration);
    const [incidentsResponse, statusPageResponse, historyPageResponse] = await Promise.all([
      fetchWithTimeout(incidentsApiUrl, {
        headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
      }),
      fetchWithTimeout(sourceUrl, {
        headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
      }),
      fetchWithTimeout(historyUrl, {
        headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
      })
    ]);

    if (!incidentsResponse.ok) {
      throw new Error(`OpenAI Status incidents API returned HTTP ${incidentsResponse.status}`);
    }
    if (!statusPageResponse.ok) {
      throw new Error(`OpenAI Status page returned HTTP ${statusPageResponse.status}`);
    }
    if (!historyPageResponse.ok) {
      throw new Error(`OpenAI Status history page returned HTTP ${historyPageResponse.status}`);
    }

    const chatGptComponents = extractOpenAiChatGptComponentsFromStatusHtml(await statusPageResponse.text());
    const incidentsPayload = (await incidentsResponse.json()) as OpenAiStatusIncidentsResponse;
    const historyHtml = await historyPageResponse.text();
    const incidents = mergeOpenAiStatusIncidents(
      incidentsPayload.incidents ?? [],
      extractOpenAiStatusIncidentsFromHistoryHtml(historyHtml)
    );
    const detailHtmlByIncidentId = await fetchOpenAiIncidentDetailHtml(incidents, period, historyHtml);
    const outageInput = {
      incidents,
      detailHtmlByIncidentId,
      chatGptComponents,
      period
    };
    const outages = getOpenAiChatGptQualifyingOutages(outageInput);
    const reviewOutages = getOpenAiReviewOutages(outageInput);
    const dailyReportState = filterNewOpenAiDailyReportDay(integration?.lastValue ?? null, period, observedAt);
    const value = formatOpenAiChatGptOutageValue(outages, period, reviewOutages, dailyReportState);

    return {
      value,
      rawValue: `${countUniqueOutageDates(outages)} day(s)`,
      unit: "outage days",
      observedAt
    };
  }
};

export async function refreshOpenAiChatGptOutagePolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  return refreshMonthlyPolymarketQueue(integration, monthlyDiscoveryConfig, now);
}

export function extractOpenAiChatGptComponentsFromStatusHtml(html: string): OpenAiStatusComponent[] {
  const nameMarker = '\\"name\\":\\"ChatGPT\\"';
  const nameIndex = html.indexOf(nameMarker);
  const start = nameIndex === -1 ? -1 : html.lastIndexOf('\\"components\\":[', nameIndex);
  if (nameIndex === -1 || start === -1) {
    throw new Error("Could not find ChatGPT component group on OpenAI Status");
  }

  const segment = html.slice(start, nameIndex);
  const components = [...segment.matchAll(/\\"component_id\\":\\"([^\\"]+)\\".*?\\"name\\":\\"([^\\"]+)\\"/g)]
    .map((match) => ({ id: match[1], name: unescapeFlightString(match[2]) }))
    .filter((component) => component.id && component.name);

  if (!components.length) {
    throw new Error("Could not find ChatGPT subcomponents on OpenAI Status");
  }

  return dedupeComponents(components);
}

export function extractOpenAiIncidentComponentImpacts(html: string): OpenAiIncidentComponentImpact[] {
  const impacts = [...html.matchAll(/\\"component_id\\":\\"([^\\"]+)\\",\\"end_at\\":\\"([^\\"]+)\\",\\"id\\":\\"[^\\"]+\\",\\"start_at\\":\\"([^\\"]+)\\",\\"status\\":\\"([^\\"]+)\\",\\"status_page_incident_id\\":\\"([^\\"]+)\\"/g)]
    .map((match) => ({
      componentId: match[1],
      endAt: match[2],
      startAt: match[3],
      status: match[4],
      incidentId: match[5]
    }))
    .filter((impact) => impact.componentId && impact.startAt && impact.endAt && impact.status && impact.incidentId);

  return [...new Map(impacts.map((impact) => [`${impact.incidentId}:${impact.componentId}:${impact.startAt}:${impact.endAt}:${impact.status}`, impact])).values()];
}

export function extractOpenAiStatusIncidentsFromHistoryHtml(html: string): OpenAiStatusIncident[] {
  const incidents = new Map<string, OpenAiStatusIncident>();
  const incidentRegex =
    /\\"component_impacts\\":\[[\s\S]*?\],\\"id\\":\\"([^\\"]+)\\",\\"name\\":\\"([^\\"]+)\\",\\"published_at\\":\\"([^\\"]+)\\",\\"status\\":\\"([^\\"]+)\\"[\s\S]*?\\"updates\\":\[(.*?)\],\\"write_up_/g;

  for (const match of html.matchAll(incidentRegex)) {
    const [segment, id, name, publishedAt, status, updates] = match;
    if (!id || incidents.has(id)) {
      continue;
    }

    const resolvedAt = getResolvedAtFromOpenAiIncidentUpdates(updates) ?? getResolvedAtFromOpenAiIncidentSegment(segment);
    incidents.set(id, {
      id,
      name: unescapeFlightString(name).trim(),
      status,
      created_at: publishedAt,
      resolved_at: status === "resolved" ? resolvedAt : null
    });
  }

  return [...incidents.values()];
}

export function getOpenAiChatGptQualifyingOutages(input: {
  incidents: OpenAiStatusIncident[];
  detailHtmlByIncidentId: Map<string, string>;
  chatGptComponents: OpenAiStatusComponent[];
  period: OpenAiOutagePeriod;
}): OpenAiChatGptOutageIncident[] {
  const chatGptComponentById = new Map(input.chatGptComponents.map((component) => [component.id, component]));
  return input.incidents
    .flatMap((incident) => {
      if (!isResolvedIncident(incident) || !incident.id || !incident.resolved_at) {
        return [];
      }

      const html = input.detailHtmlByIncidentId.get(incident.id);
      if (!html) {
        return [];
      }

      const impacts = extractOpenAiIncidentComponentImpacts(html).filter((impact) => {
        return impact.incidentId === incident.id && chatGptComponentById.has(impact.componentId) && qualifyingComponentStatuses.has(impact.status);
      });
      const outageDatesEt = [...new Set(impacts.flatMap((impact) => getOutageDatesEt(impact.startAt, impact.endAt, input.period)))].sort();
      if (!outageDatesEt.length) {
        return [];
      }

      return [
        {
          id: incident.id,
          name: incident.name?.trim() || "Unnamed incident",
          resolvedAt: incident.resolved_at,
          url: buildIncidentUrl(incident.id),
          componentNames: [...new Set(impacts.map((impact) => chatGptComponentById.get(impact.componentId)?.name ?? impact.componentId))].sort(),
          componentStatuses: [...new Set(impacts.map((impact) => impact.status))].sort(),
          outageDatesEt
        }
      ];
    })
    .sort((left, right) => left.resolvedAt.localeCompare(right.resolvedAt));
}

export function getOpenAiReviewOutages(input: {
  incidents: OpenAiStatusIncident[];
  detailHtmlByIncidentId: Map<string, string>;
  chatGptComponents: OpenAiStatusComponent[];
  period: OpenAiOutagePeriod;
}): OpenAiReviewOutageIncident[] {
  const chatGptComponentIds = new Set(input.chatGptComponents.map((component) => component.id));
  return input.incidents
    .flatMap((incident) => {
      if (!isResolvedIncident(incident) || !incident.id || !incident.resolved_at) {
        return [];
      }

      const html = input.detailHtmlByIncidentId.get(incident.id);
      if (!html) {
        return [];
      }

      const impacts = extractOpenAiIncidentComponentImpacts(html).filter((impact) => {
        return impact.incidentId === incident.id && qualifyingComponentStatuses.has(impact.status);
      });
      const outageDatesEt = [...new Set(impacts.flatMap((impact) => getOutageDatesEt(impact.startAt, impact.endAt, input.period)))].sort();
      if (!outageDatesEt.length) {
        return [];
      }

      const componentIds = [...new Set(impacts.map((impact) => impact.componentId))].sort();
      return [
        {
          id: incident.id,
          name: incident.name?.trim() || "Unnamed incident",
          resolvedAt: incident.resolved_at,
          url: buildIncidentUrl(incident.id),
          componentNames: componentIds,
          componentStatuses: [...new Set(impacts.map((impact) => impact.status))].sort(),
          outageDatesEt,
          isChatGptAffected: componentIds.some((componentId) => chatGptComponentIds.has(componentId))
        }
      ];
    })
    .sort((left, right) => left.resolvedAt.localeCompare(right.resolvedAt));
}

export function filterNewOpenAiDailyReportDay(
  previousValue: string | null,
  period: OpenAiOutagePeriod,
  now = new Date()
): OpenAiDailyReportState {
  const reportedDates = parseStoredReportedDailyDates(previousValue);
  const latestReportableDay = getLatestCompletedEtDayInPeriod(period, now);
  if (latestReportableDay && !reportedDates.has(latestReportableDay)) {
    reportedDates.add(latestReportableDay);
    return {
      newDailyReportDay: latestReportableDay,
      reportedDailyDates: [...reportedDates].sort()
    };
  }

  return {
    newDailyReportDay: null,
    reportedDailyDates: [...reportedDates].sort()
  };
}

export function formatOpenAiChatGptOutageValue(
  outages: OpenAiChatGptOutageIncident[],
  period: OpenAiOutagePeriod,
  reviewOutages: OpenAiReviewOutageIncident[] = outages.map((outage) => ({ ...outage, isChatGptAffected: true })),
  dailyReportState: OpenAiDailyReportState = { newDailyReportDay: null, reportedDailyDates: [] }
): string {
  const outageDates = getUniqueOutageDates(outages);
  return [
    "Metric: OpenAI ChatGPT Partial/Full Outage days",
    `Period: ${period.label} ET`,
    `Qualifying days: ${outageDates.length}`,
    `Days: ${outageDates.length ? outageDates.join(", ") : "none"}`,
    "New Daily Report:",
    dailyReportState.newDailyReportDay
      ? formatOpenAiDailyReportDay(dailyReportState.newDailyReportDay, outageDates)
      : "none",
    "Reported Daily Dates:",
    dailyReportState.reportedDailyDates.length ? dailyReportState.reportedDailyDates.join(", ") : "none",
    "Qualifying resolved incidents:",
    outages.length ? outages.map(formatOutageIncident).join("\n") : "none",
    "Review-only Partial/Full Outage incidents:",
    reviewOutages.length ? reviewOutages.map(formatReviewOutageIncident).join("\n") : "none",
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function openAiChatGptOutagesShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  const dailyReportSection = extractStoredSection(currentValue, "New Daily Report", "Reported Daily Dates");
  if (dailyReportSection && dailyReportSection.trim() !== "none") {
    return true;
  }

  const previousDays = new Set(parseOutageDays(previousValue));
  return parseOutageDays(currentValue).some((day) => !previousDays.has(day));
}

export function getOpenAiChatGptOutagePeriod(integration?: Integration, now = new Date()): OpenAiOutagePeriod {
  const settings = parseSettingsJson(integration?.settingsJson);
  const settingsYear = Number(settings.year);
  const settingsMonth = Number(settings.month);
  if (isValidOpenAiOutagePeriod(settingsYear, settingsMonth)) {
    return buildOpenAiOutagePeriod(settingsYear, settingsMonth);
  }

  const polymarketUrl = integration?.polymarketUrl ?? defaultPolymarketUrl;
  const window = parsePolymarketMonthWindow(polymarketUrl, now);
  if (window) {
    return buildOpenAiOutagePeriod(window.year, window.month);
  }

  return buildOpenAiOutagePeriod(defaultYear, defaultMonth);
}

async function fetchOpenAiIncidentDetailHtml(
  incidents: OpenAiStatusIncident[],
  period: OpenAiOutagePeriod,
  historyHtml?: string
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const candidates = incidents.filter((incident) => incident.id && mightOverlapPeriod(incident, period));
  await Promise.all(
    candidates.map(async (incident) => {
      if (historyHtml?.includes(`\\"status_page_incident_id\\":\\"${incident.id}\\"`)) {
        result.set(incident.id!, historyHtml);
        return;
      }

      const response = await fetchWithTimeout(buildIncidentUrl(incident.id!), {
        headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
      });
      if (response.ok) {
        result.set(incident.id!, await response.text());
      }
    })
  );
  return result;
}

function mergeOpenAiStatusIncidents(...incidentLists: OpenAiStatusIncident[][]): OpenAiStatusIncident[] {
  const incidents = new Map<string, OpenAiStatusIncident>();
  for (const incident of incidentLists.flat()) {
    if (!incident.id) {
      continue;
    }

    const existing = incidents.get(incident.id);
    incidents.set(incident.id, {
      ...incident,
      ...existing,
      ...incident,
      name: incident.name ?? existing?.name,
      status: incident.status ?? existing?.status,
      created_at: incident.created_at ?? existing?.created_at,
      resolved_at: incident.resolved_at ?? existing?.resolved_at
    });
  }

  return [...incidents.values()];
}

function getResolvedAtFromOpenAiIncidentUpdates(updates: string): string | null {
  const resolvedUpdates = [...updates.matchAll(/\\"published_at\\":\\"([^\\"]+)\\",\\"to_status\\":\\"resolved\\"/g)];
  return resolvedUpdates.at(-1)?.[1] ?? null;
}

function getResolvedAtFromOpenAiIncidentSegment(segment: string): string | null {
  const summaries = [...segment.matchAll(/\\"end_at\\":\\"([^\\"]+)\\",\\"start_at\\":\\"[^\\"]+\\",\\"worst_component_status\\":\\"[^\\"]+\\"/g)];
  return summaries
    .map((match) => match[1])
    .filter((value) => value !== "$undefined")
    .at(-1) ?? null;
}

function mightOverlapPeriod(incident: OpenAiStatusIncident, period: OpenAiOutagePeriod): boolean {
  const startedAt = parseDate(incident.created_at);
  const resolvedAt = parseDate(incident.resolved_at ?? incident.updated_at);
  if (!startedAt && !resolvedAt) {
    return false;
  }

  const startMs = startedAt?.getTime() ?? resolvedAt!.getTime();
  const endMs = resolvedAt?.getTime() ?? startedAt!.getTime();
  return endMs >= period.startAt.getTime() && startMs < period.endAt.getTime() + 7 * 24 * 60 * 60_000;
}

function getOutageDatesEt(startAt: string, endAt: string, period: OpenAiOutagePeriod): string[] {
  const start = parseDate(startAt);
  const end = parseDate(endAt);
  if (!start || !end) {
    return [];
  }

  const startMs = Math.max(start.getTime(), period.startAt.getTime());
  const endMs = Math.min(end.getTime(), period.endAt.getTime());
  if (endMs <= startMs) {
    return [];
  }

  return listDateRange(getEasternDate(new Date(startMs)), getEasternDate(new Date(endMs - 1)));
}

function listDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let current = startDate;
  while (current <= endDate) {
    dates.push(current);
    current = addDate(current, 1);
  }
  return dates;
}

function addDate(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function buildOpenAiOutagePeriod(year: number, month: number): OpenAiOutagePeriod {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const startAt = parseManualEasternDateTime(`${year}-${padMonth(month)}-01 00:00`);
  const endAt = parseManualEasternDateTime(`${nextYear}-${padMonth(nextMonth)}-01 00:00`);
  if (!startAt || !endAt) {
    throw new Error(`Invalid ChatGPT outage period: ${year}-${padMonth(month)}`);
  }

  return {
    year,
    month,
    label: `${year}-${padMonth(month)}`,
    startAt,
    endAt
  };
}

function isResolvedIncident(incident: OpenAiStatusIncident): boolean {
  return incident.status?.toLowerCase() === "resolved" && Boolean(incident.resolved_at);
}

function countUniqueOutageDates(outages: OpenAiChatGptOutageIncident[]): number {
  return getUniqueOutageDates(outages).length;
}

function getUniqueOutageDates(outages: OpenAiChatGptOutageIncident[]): string[] {
  return [...new Set(outages.flatMap((incident) => incident.outageDatesEt))].sort();
}

function getLatestCompletedEtDayInPeriod(period: OpenAiOutagePeriod, now: Date): string | null {
  const currentEtDate = getEasternDate(now);
  const candidate = addDate(currentEtDate, -1);
  const firstPeriodDate = getEasternDate(period.startAt);
  const lastPeriodDate = addDate(getEasternDate(period.endAt), -1);
  if (candidate < firstPeriodDate) {
    return null;
  }

  return candidate > lastPeriodDate ? lastPeriodDate : candidate;
}

function formatOpenAiDailyReportDay(day: string, outageDates: string[]): string {
  return outageDates.includes(day)
    ? `${day} ET - qualifying ChatGPT Partial/Full Outage day currently detected`
    : `${day} ET - no qualifying ChatGPT Partial/Full Outage currently detected`;
}

function formatOutageIncident(incident: OpenAiChatGptOutageIncident): string {
  return [
    `${incident.outageDatesEt.join(", ")} — ${incident.name}`,
    `Status: ${incident.componentStatuses.map(formatComponentStatus).join(", ")}`,
    `Components: ${incident.componentNames.join(", ")}`,
    `Resolved: ${incident.resolvedAt}`,
    `Link: ${incident.url}`
  ].join(" | ");
}

function formatReviewOutageIncident(incident: OpenAiReviewOutageIncident): string {
  return [
    `${incident.isChatGptAffected ? "COUNTED" : "REVIEW"}: ${incident.outageDatesEt.join(", ")} — ${incident.name}`,
    `Status: ${incident.componentStatuses.map(formatComponentStatus).join(", ")}`,
    `Components: ${incident.componentNames.join(", ")}`,
    `Resolved: ${incident.resolvedAt}`,
    `Link: ${incident.url}`
  ].join(" | ");
}

function parseOutageDays(value: string | null): string[] {
  const match = value?.match(/^Days:\s*(.+)$/m);
  if (!match || match[1].trim() === "none") {
    return [];
  }

  return [...match[1].matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((date) => date[0]);
}

function parseStoredReportedDailyDates(previousValue: string | null): Set<string> {
  const section = extractStoredSection(previousValue, "Reported Daily Dates", "Qualifying resolved incidents");
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

function formatComponentStatus(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function dedupeComponents(components: OpenAiStatusComponent[]): OpenAiStatusComponent[] {
  return [...new Map(components.map((component) => [component.id, component])).values()];
}

function buildIncidentUrl(id: string): string {
  return `https://status.openai.com/incidents/${id}`;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getEasternDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: easternTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function isValidOpenAiOutagePeriod(year: number, month: number): boolean {
  return Number.isInteger(year) && Number.isInteger(month) && year >= 2026 && year <= 2100 && month >= 1 && month <= 12;
}

function padMonth(month: number): string {
  return String(month).padStart(2, "0");
}

function unescapeFlightString(value: string): string {
  return value.replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}
