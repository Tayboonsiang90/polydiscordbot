import type { AdapterValue, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";

const apiUrl = "https://history-events-eu-west-1-prod.s3.amazonaws.com/historyevents.json";
const sourceUrl = "https://health.aws.amazon.com/health/status";
const noDisruptedValue = "No disrupted AWS service interruption events found";
const disruptedStatus = "3";

export type AwsHealthEventLog = {
  summary?: string;
  message?: string;
  status?: string | number;
  timestamp?: string | number;
};

export type AwsImpactedService = {
  service_name?: string;
  current?: string;
  max?: string;
};

export type AwsHealthEvent = {
  arn?: string;
  date?: string;
  region_name?: string;
  service?: string;
  service_name?: string;
  summary?: string;
  status?: string;
  event_log?: AwsHealthEventLog[];
  impacted_services?: Record<string, AwsImpactedService>;
};

export type AwsHistoryEventsResponse = Record<string, AwsHealthEvent[]>;

export function extractAwsDisruptedEventValue(response: AwsHistoryEventsResponse): string {
  const events = getDisruptedAwsEvents(response);

  if (events.length === 0) {
    return noDisruptedValue;
  }

  return [
    "AWS DISRUPTED EVENT DETECTED",
    ...events.slice(0, 5).map((event, index) =>
      [
        events.length > 1 ? `Event ${index + 1}: ${event.summary ?? "Unnamed event"}` : `Event: ${event.summary ?? "Unnamed event"}`,
        `Service: ${formatAwsService(event)}`,
        `Region: ${formatAwsRegion(event)}`,
        `Severity: disrupted`,
        `Started: ${formatAwsTimestamp(event.date)}`,
        `Latest update: ${formatAwsTimestamp(getLatestEventLogTimestamp(event))}`,
        `ARN: ${event.arn ?? "unknown"}`
      ].join("\n")
    )
  ].join("\n\n");
}

export function getDisruptedAwsEvents(response: AwsHistoryEventsResponse): AwsHealthEvent[] {
  return Object.entries(response)
    .flatMap(([service, events]) => events.map((event) => ({ service, ...event })))
    .flat()
    .filter(isAwsHealthEvent)
    .filter(isDisruptedEvent)
    .sort((left, right) => getEventSortTime(right) - getEventSortTime(left));
}

export const awsDisruptedAdapter: WebsiteAdapter = {
  id: "aws-disrupted-events",
  commandName: "aws",
  displayName: "AWS Disrupted Events",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/aws-service-disrupted-by-june-30",
  defaultChannelName: "aws-disrupted",
  alertRoleName: "AWS Disrupted Alerts",
  alertRoleEmoji: "\u26A0",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(apiUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`AWS Health Dashboard returned HTTP ${response.status}`);
    }

    const data = JSON.parse(decodeAwsJson(await response.arrayBuffer())) as AwsHistoryEventsResponse;
    const value = extractAwsDisruptedEventValue(data);
    return {
      value,
      rawValue: value,
      unit: "disrupted service interruption event",
      observedAt: new Date()
    };
  }
};

function isAwsHealthEvent(value: unknown): value is AwsHealthEvent {
  return typeof value === "object" && value !== null;
}

function isDisruptedEvent(event: AwsHealthEvent): boolean {
  if (event.status === disruptedStatus) {
    return true;
  }

  if (event.event_log?.some((log) => String(log.status) === disruptedStatus)) {
    return true;
  }

  return Object.values(event.impacted_services ?? {}).some(
    (service) => service.current === disruptedStatus || service.max === disruptedStatus
  );
}

function getEventSortTime(event: AwsHealthEvent): number {
  return Number(getLatestEventLogTimestamp(event) ?? event.date ?? 0) * 1000;
}

function getLatestEventLogTimestamp(event: AwsHealthEvent): string | number | undefined {
  return event.event_log?.reduce<string | number | undefined>((latest, log) => {
    if (latest === undefined) {
      return log.timestamp;
    }

    return Number(log.timestamp ?? 0) > Number(latest) ? log.timestamp : latest;
  }, undefined);
}

function formatAwsTimestamp(timestamp: string | number | undefined): string {
  if (timestamp === undefined) {
    return "unknown";
  }

  const value = Number(timestamp);
  return Number.isFinite(value) ? new Date(value * 1000).toISOString() : "unknown";
}

function formatAwsService(event: AwsHealthEvent): string {
  if (event.service_name) {
    return event.service_name;
  }

  if (event.service) {
    return event.service;
  }

  const service = event.arn?.match(/:event\/([^/]+)/)?.[1];
  return service ? service.replace(/_/g, " ") : "unknown";
}

function formatAwsRegion(event: AwsHealthEvent): string {
  return event.region_name ?? event.arn?.match(/:health:([^:]+)::event/)?.[1] ?? "unknown";
}

function decodeAwsJson(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes).replace(/^\uFEFF/, "");
  }

  return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
}

