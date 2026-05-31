import type {
  AddressLabelAction,
  AddressLabelEntry,
  AddressLabelImportIssue,
  AddressLabelImportSummary,
  AddressLabelUpdateOptions,
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
  labelQuery?: string,
  options: AddressLabelUpdateOptions = {}
): AddressLabelUpdateResult {
  const settings = parseSettingsJson(settingsJson);
  const addressLabels = getAddressLabelsFromSettings(settings);

  if (action === "list" || action === "export") {
    return {
      action,
      changed: false,
      message: addressLabels.length
        ? `${addressLabels.length} address label(s) configured.`
        : action === "export"
          ? "No address labels configured; exported an empty CSV template."
          : "No address labels configured.",
      addressLabels,
      settingsJson: settingsJson ?? JSON.stringify({ ...settings, addressLabels })
    };
  }

  if (action === "import") {
    if (options.importText === undefined) {
      throw new Error("Import needs an attached CSV or text file.");
    }
    return importAddressLabelsInSettingsJson(settingsJson, options.importText, { dryRun: options.dryRun ?? true });
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

export function importAddressLabelsInSettingsJson(
  settingsJson: string | null,
  importText: string,
  options: { dryRun?: boolean } = {}
): AddressLabelUpdateResult {
  const settings = parseSettingsJson(settingsJson);
  const addressLabels = getAddressLabelsFromSettings(settings);
  const dryRun = options.dryRun ?? true;
  const parsed = parseAddressLabelImport(importText);
  const existingByAddress = new Map(addressLabels.map((entry) => [entry.address, entry]));
  const importedByAddress = new Map(parsed.labels.map((entry) => [entry.address, entry]));

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const entry of importedByAddress.values()) {
    const existing = existingByAddress.get(entry.address);
    if (!existing) {
      added += 1;
    } else if (existing.label !== entry.label) {
      updated += 1;
    } else {
      unchanged += 1;
    }
  }

  const nextLabels = uniqueAddressLabels([
    ...addressLabels.filter((entry) => !importedByAddress.has(entry.address)),
    ...importedByAddress.values()
  ]).sort(compareAddressLabels);
  const summary: AddressLabelImportSummary = {
    dryRun,
    totalRows: parsed.totalRows,
    validRows: parsed.validRows,
    uniqueLabels: importedByAddress.size,
    added,
    updated,
    unchanged,
    invalidRows: parsed.invalidRows,
    duplicateRows: parsed.duplicateRows
  };
  const changed = added + updated > 0;
  const changeText = `${added} add, ${updated} update, ${unchanged} unchanged`;

  return {
    action: "import",
    changed: !dryRun && changed,
    message: dryRun
      ? `Import preview: ${changeText}. Rerun with dry-run:false to apply.`
      : changed
        ? `Imported address labels: ${changeText}.`
        : `Import completed: ${changeText}.`,
    addressLabels: dryRun ? addressLabels : nextLabels,
    importSummary: summary,
    settingsJson: dryRun ? settingsJson ?? JSON.stringify({ ...settings, addressLabels }) : JSON.stringify({ ...settings, addressLabels: nextLabels })
  };
}

export function exportAddressLabelsCsv(labels: AddressLabelEntry[]): string {
  const lines = ["name,address", ...labels.map((entry) => `${escapeCsvValue(entry.label)},${entry.address}`)];
  return `${lines.join("\n")}\n`;
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

function parseAddressLabelImport(importText: string): {
  labels: AddressLabelEntry[];
  totalRows: number;
  validRows: number;
  invalidRows: AddressLabelImportIssue[];
  duplicateRows: AddressLabelImportIssue[];
} {
  const labelsByAddress = new Map<string, AddressLabelEntry>();
  const lineByAddress = new Map<string, number>();
  const invalidRows: AddressLabelImportIssue[] = [];
  const duplicateRows: AddressLabelImportIssue[] = [];
  let totalRows = 0;
  let validRows = 0;

  const lines = importText.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (isAddressImportHeader(line)) {
      continue;
    }

    totalRows += 1;
    const addressMatches = [...line.matchAll(/0x[0-9a-fA-F]{40}/g)];
    if (addressMatches.length === 0) {
      invalidRows.push({ lineNumber, reason: "missing 0x address", value: truncateIssueValue(line) });
      continue;
    }
    if (addressMatches.length > 1) {
      invalidRows.push({ lineNumber, reason: "multiple 0x addresses", value: truncateIssueValue(line) });
      continue;
    }

    const match = addressMatches[0];
    const address = normalizeAddress(match[0]);
    const label = normalizeLabel(extractImportLabel(line, match.index ?? 0, match[0].length));
    if (!address) {
      invalidRows.push({ lineNumber, reason: "invalid 0x address", value: truncateIssueValue(line) });
      continue;
    }
    if (!label) {
      invalidRows.push({ lineNumber, reason: "missing nickname", value: truncateIssueValue(line), address });
      continue;
    }

    validRows += 1;
    const previousLineNumber = lineByAddress.get(address);
    if (previousLineNumber !== undefined) {
      duplicateRows.push({
        lineNumber,
        previousLineNumber,
        reason: "duplicate address; last row wins",
        value: truncateIssueValue(line),
        address
      });
    }
    labelsByAddress.set(address, { address, label });
    lineByAddress.set(address, lineNumber);
  }

  return {
    labels: [...labelsByAddress.values()].sort(compareAddressLabels),
    totalRows,
    validRows,
    invalidRows,
    duplicateRows
  };
}

function isAddressImportHeader(line: string): boolean {
  const normalized = line.toLowerCase();
  return !addressPattern.test(line) && normalized.includes("address") && /(name|nickname|label)/i.test(normalized);
}

function extractImportLabel(line: string, addressStart: number, addressLength: number): string {
  return `${line.slice(0, addressStart)} ${line.slice(addressStart + addressLength)}`
    .trim()
    .replace(/^[\s,;:=|\-"'`]+|[\s,;:=|\-"'`]+$/g, "")
    .replace(/^name\s*[:=]\s*/i, "")
    .replace(/^nickname\s*[:=]\s*/i, "")
    .replace(/^label\s*[:=]\s*/i, "")
    .replace(/[\t ]+/g, " ")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

function truncateIssueValue(value: string): string {
  return value.length > 140 ? `${value.slice(0, 137)}...` : value;
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

function escapeCsvValue(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export const testOnlyAddressLabelHelpers = {
  resetProfileCache(): void {
    profileCache.clear();
  }
};
