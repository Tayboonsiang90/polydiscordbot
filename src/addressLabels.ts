import type {
  AddressLabelAction,
  AddressLabelEntry,
  AddressLabelUpdateResult,
  AddressProfileStatus,
  EventMonitorPost
} from "./integrations/types.js";
import { parseSettingsJson } from "./settingsJson.js";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const polymarketTradesApiUrl = "https://data-api.polymarket.com/trades";
const polymarketProfileBaseUrl = "https://polymarket.com";
const profileCacheMs = 10 * 60_000;
const profileLookupTimeoutMs = 2_500;

type ProfileCacheEntry = {
  expiresAtMs: number;
  status: AddressProfileStatus;
};

const profileCache = new Map<string, ProfileCacheEntry>();

export function getAddressLabelsFromSettingsJson(settingsJson: string | null): AddressLabelEntry[] {
  const settings = parseSettingsJson(settingsJson);
  return getAddressLabelsFromSettings(settings);
}

export function updateAddressLabelsInSettingsJson(
  settingsJson: string | null,
  action: AddressLabelAction,
  addressQuery?: string,
  labelQuery?: string
): AddressLabelUpdateResult {
  const settings = parseSettingsJson(settingsJson);
  const addressLabels = getAddressLabelsFromSettings(settings);

  if (action === "list") {
    return {
      action,
      changed: false,
      message: addressLabels.length ? `${addressLabels.length} address label(s) configured.` : "No address labels configured.",
      addressLabels,
      settingsJson: settingsJson ?? JSON.stringify({ ...settings, addressLabels })
    };
  }

  if (action === "clear") {
    return {
      action,
      changed: addressLabels.length > 0,
      message: addressLabels.length ? "Cleared all address labels." : "No address labels were configured.",
      addressLabels: [],
      settingsJson: JSON.stringify({ ...settings, addressLabels: [] })
    };
  }

  const address = normalizeAddressOrThrow(addressQuery);

  if (action === "remove") {
    const removedLabel = addressLabels.find((entry) => entry.address === address);
    const nextLabels = addressLabels.filter((entry) => entry.address !== address);
    return {
      action,
      changed: nextLabels.length !== addressLabels.length,
      message: removedLabel ? `Removed label for ${address}.` : `${address} did not have a label.`,
      matchedLabel: removedLabel,
      addressLabels: nextLabels,
      settingsJson: JSON.stringify({ ...settings, addressLabels: nextLabels })
    };
  }

  if (action === "add") {
    const label = normalizeLabelOrThrow(labelQuery);
    const matchedLabel = { address, label };
    const existing = addressLabels.find((entry) => entry.address === address);
    const nextLabels = uniqueAddressLabels(
      existing
        ? addressLabels.map((entry) => (entry.address === address ? matchedLabel : entry))
        : [...addressLabels, matchedLabel]
    ).sort(compareAddressLabels);
    const changed = !existing || existing.label !== label;
    return {
      action,
      changed,
      message: existing
        ? changed
          ? `Updated ${address} to ${label}.`
          : `${address} was already labelled ${label}.`
        : `Added ${label} for ${address}.`,
      matchedLabel,
      addressLabels: nextLabels,
      settingsJson: JSON.stringify({ ...settings, addressLabels: nextLabels })
    };
  }

  throw new Error(`Unsupported address label action: ${action}`);
}

export async function enrichEventPostAddressProfiles(post: EventMonitorPost): Promise<EventMonitorPost> {
  const summary = post.prioritySummary;
  if (!summary) {
    return post;
  }

  const [proposerProfile, disputerProfile] = await Promise.all([
    summary.proposer ? fetchPolymarketAddressProfileStatus(summary.proposer) : Promise.resolve(undefined),
    summary.disputer ? fetchPolymarketAddressProfileStatus(summary.disputer) : Promise.resolve(undefined)
  ]);

  return {
    ...post,
    prioritySummary: {
      ...summary,
      ...(proposerProfile ? { proposerProfile } : {}),
      ...(disputerProfile ? { disputerProfile } : {})
    }
  };
}

export async function fetchPolymarketAddressProfileStatus(
  address: string,
  now = new Date()
): Promise<AddressProfileStatus | undefined> {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    return undefined;
  }

  const cached = profileCache.get(normalized);
  if (cached && cached.expiresAtMs > now.getTime()) {
    return cached.status;
  }

  const url = new URL(polymarketTradesApiUrl);
  url.searchParams.set("user", normalized);
  url.searchParams.set("limit", "1");
  url.searchParams.set("takerOnly", "false");

  const baseStatus = {
    address: normalized,
    profileUrl: `${polymarketProfileBaseUrl}/${normalized}`,
    checkedAt: now.toISOString(),
    sourceUrl: url.toString()
  };

  let status: AddressProfileStatus;
  try {
    const response = await fetch(url.toString(), {
      headers: { "user-agent": "PolymarketResolutionMonitorBot/0.1" },
      signal: AbortSignal.timeout(profileLookupTimeoutMs)
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    status = { ...baseStatus, hasTrades: Array.isArray(payload) && payload.length > 0 };
  } catch (error) {
    status = { ...baseStatus, error: formatError(error) };
  }

  profileCache.set(normalized, { status, expiresAtMs: now.getTime() + profileCacheMs });
  return status;
}

export function formatAddressWithLabel(
  address: string,
  labels: AddressLabelEntry[],
  profile?: AddressProfileStatus
): string {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    return address;
  }

  const label = labels.find((entry) => entry.address === normalized)?.label;
  const profileForAddress = profile?.address === normalized ? profile : undefined;
  const profileSuffix = profileForAddress?.hasTrades ? ` ([Polymarket](${profileForAddress.profileUrl}))` : "";
  const lines = [`${label ?? normalized}${profileSuffix}`];
  if (label) {
    lines.push(normalized);
  }
  if (profileForAddress?.hasTrades === false) {
    lines.push("Polymarket: no trades found");
  } else if (profileForAddress?.error) {
    lines.push("Polymarket: profile check failed");
  }
  return lines.join("\n");
}

function getAddressLabelsFromSettings(settings: Record<string, unknown>): AddressLabelEntry[] {
  return uniqueAddressLabels(
    Array.isArray(settings.addressLabels)
      ? settings.addressLabels.map(sanitizeAddressLabel).filter((entry): entry is AddressLabelEntry => Boolean(entry))
      : []
  ).sort(compareAddressLabels);
}

function sanitizeAddressLabel(value: unknown): AddressLabelEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Partial<AddressLabelEntry>;
  const address = normalizeAddress(entry.address);
  const label = typeof entry.label === "string" ? normalizeLabel(entry.label) : "";
  return address && label ? { address, label } : null;
}

function normalizeAddressOrThrow(address: string | undefined): string {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    throw new Error("Address must be a 0x-prefixed 20-byte EVM address.");
  }
  return normalized;
}

function normalizeAddress(address: string | undefined): string | null {
  const trimmed = address?.trim();
  return trimmed && addressPattern.test(trimmed) ? trimmed.toLowerCase() : null;
}

function normalizeLabelOrThrow(label: string | undefined): string {
  const normalized = normalizeLabel(label ?? "");
  if (!normalized) {
    throw new Error("Address label name is required.");
  }
  return normalized;
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").slice(0, 80);
}

function uniqueAddressLabels(labels: AddressLabelEntry[]): AddressLabelEntry[] {
  const byAddress = new Map<string, AddressLabelEntry>();
  for (const label of labels) {
    byAddress.set(label.address, label);
  }
  return [...byAddress.values()];
}

function compareAddressLabels(left: AddressLabelEntry, right: AddressLabelEntry): number {
  return left.label.localeCompare(right.label) || left.address.localeCompare(right.address);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const testOnlyAddressLabelHelpers = {
  resetProfileCache(): void {
    profileCache.clear();
  }
};
