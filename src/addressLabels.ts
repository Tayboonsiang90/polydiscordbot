import type {
  AddressLabelAction,
  AddressLabelEntry,
  AddressLabelImportIssue,
  AddressLabelImportSummary,
  AddressLabelUpdateOptions,
  AddressLabelUpdateResult,
  AddressHedgeStatus,
  AddressProfileStatus,
  EventMonitorPost
} from "./integrations/types.js";
import { parseSettingsJson } from "./settingsJson.js";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const conditionIdPattern = /^0x[0-9a-fA-F]{64}$/;
const polymarketTradesApiUrl = "https://data-api.polymarket.com/trades";
const polymarketPositionsApiUrl = "https://data-api.polymarket.com/positions";
const polymarketPublicProfileApiUrl = "https://gamma-api.polymarket.com/public-profile";
const polymarketProfileBaseUrl = "https://polymarket.com";
const profileCacheMs = 10 * 60_000;
const profileErrorCacheMs = 60_000;
const profileLookupTimeoutMs = 2_500;
const positionLookupTimeoutMs = 2_500;

type PolymarketPublicProfile = {
  proxyWallet?: string | null;
  displayUsernamePublic?: boolean | null;
  name?: string | null;
  pseudonym?: string | null;
};

type PolymarketTrade = {
  name?: string;
  pseudonym?: string;
};

type PolymarketPosition = {
  conditionId?: string;
  outcome?: string;
  size?: string | number;
  currentValue?: string | number;
  avgPrice?: string | number;
  curPrice?: string | number;
  title?: string;
  slug?: string;
};

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
  const oppositeOutcome = getOppositeOutcome(summary.proposedOutcomeSide);
  const [proposerHedge, disputerHedge] =
    summary.conditionId && oppositeOutcome
      ? await Promise.all([
          summary.proposer
            ? fetchPolymarketAddressHedgeStatus(summary.proposer, proposerProfile, summary.conditionId, oppositeOutcome)
            : Promise.resolve(undefined),
          summary.disputer
            ? fetchPolymarketAddressHedgeStatus(summary.disputer, disputerProfile, summary.conditionId, oppositeOutcome)
            : Promise.resolve(undefined)
        ])
      : [undefined, undefined];

  return {
    ...post,
    prioritySummary: {
      ...summary,
      ...(proposerProfile ? { proposerProfile } : {}),
      ...(proposerHedge ? { proposerHedge } : {}),
      ...(disputerProfile ? { disputerProfile } : {}),
      ...(disputerHedge ? { disputerHedge } : {})
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

  const baseStatus = {
    address: normalized,
    profileUrl: `${polymarketProfileBaseUrl}/${normalized}`,
    checkedAt: now.toISOString(),
    sourceUrl: ""
  };

  let status: AddressProfileStatus;
  try {
    const profileLookup = await fetchPolymarketPublicProfile(normalized);
    const profileWallet = normalizeAddress(profileLookup.profile?.proxyWallet ?? undefined) ?? normalized;
    const tradeLookup = await fetchPolymarketTradeStatus(profileWallet);
    const profileName = getPolymarketProfileName(profileLookup.profile, tradeLookup.latestTrade);
    status = {
      ...baseStatus,
      profileUrl: buildPolymarketProfileUrl(normalized, profileName, profileLookup.profile?.displayUsernamePublic),
      ...(profileName ? { profileName } : {}),
      ...(profileLookup.found ? { linkedProfile: true, profileWallet } : { linkedProfile: false }),
      sourceUrl: [profileLookup.sourceUrl, tradeLookup.sourceUrl].filter(Boolean).join(" | "),
      hasTrades: tradeLookup.hasTrades
    };
  } catch (error) {
    status = { ...baseStatus, sourceUrl: buildPublicProfileUrl(normalized).toString(), error: formatError(error) };
  }

  profileCache.set(normalized, { status, expiresAtMs: now.getTime() + (status.error ? profileErrorCacheMs : profileCacheMs) });
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
  const profileSuffix = profileForAddress?.hasTrades ? formatPolymarketProfileSuffix(profileForAddress) : "";
  const displayLabel = label ?? profileForAddress?.profileName ?? normalized;
  const lines = [`${displayLabel}${profileSuffix}`];
  if (displayLabel !== normalized) {
    lines.push(normalized);
  }
  if (profileForAddress?.hasTrades === false) {
    lines.push(profileForAddress.linkedProfile ? "Polymarket: profile found, no trades found" : "Polymarket: no linked profile/trades found");
  }
  return lines.join("\n");
}

async function fetchPolymarketPublicProfile(address: string): Promise<{
  found: boolean;
  profile?: PolymarketPublicProfile;
  sourceUrl: string;
}> {
  const url = buildPublicProfileUrl(address);
  const response = await fetch(url.toString(), {
    headers: { "user-agent": "PolymarketResolutionMonitorBot/0.1" },
    signal: AbortSignal.timeout(profileLookupTimeoutMs)
  });
  if (response.status === 404) {
    return { found: false, sourceUrl: url.toString() };
  }
  if (!response.ok) {
    throw new Error(`Polymarket public profile HTTP ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  if (!payload || typeof payload !== "object") {
    throw new Error("Unexpected Polymarket public profile response");
  }

  return { found: true, profile: payload as PolymarketPublicProfile, sourceUrl: url.toString() };
}

async function fetchPolymarketTradeStatus(address: string): Promise<{
  hasTrades: boolean;
  latestTrade?: PolymarketTrade;
  sourceUrl: string;
}> {
  const url = new URL(polymarketTradesApiUrl);
  url.searchParams.set("user", address);
  url.searchParams.set("limit", "1");
  url.searchParams.set("takerOnly", "false");

  const response = await fetch(url.toString(), {
    headers: { "user-agent": "PolymarketResolutionMonitorBot/0.1" },
    signal: AbortSignal.timeout(profileLookupTimeoutMs)
  });
  if (!response.ok) {
    throw new Error(`Polymarket trades HTTP ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("Unexpected Polymarket trades response");
  }

  const latestTrade = payload.find((entry): entry is PolymarketTrade => Boolean(entry && typeof entry === "object"));
  return { hasTrades: payload.length > 0, ...(latestTrade ? { latestTrade } : {}), sourceUrl: url.toString() };
}

async function fetchPolymarketAddressHedgeStatus(
  address: string,
  profile: AddressProfileStatus | undefined,
  conditionId: string,
  oppositeOutcome: "YES" | "NO",
  now = new Date()
): Promise<AddressHedgeStatus | undefined> {
  const normalized = normalizeAddress(address);
  const normalizedConditionId = normalizeConditionId(conditionId);
  if (!normalized || !normalizedConditionId) {
    return undefined;
  }

  const profileWallet = normalizeAddress(profile?.profileWallet) ?? normalized;
  const url = buildPositionsUrl(profileWallet, normalizedConditionId);
  const baseStatus = {
    address: normalized,
    profileWallet,
    conditionId: normalizedConditionId,
    oppositeOutcome,
    checkedAt: now.toISOString(),
    sourceUrl: url.toString()
  };
  if (profile?.error) {
    return { ...baseStatus, hasOppositePosition: false, error: `Polymarket profile lookup failed: ${profile.error}` };
  }

  try {
    const positions = await fetchPolymarketPositions(url);
    const oppositePosition = positions.find(
      (position) => normalizeOutcome(position.outcome) === oppositeOutcome && (toFiniteNumber(position.size) ?? 0) > 0
    );
    if (!oppositePosition) {
      return { ...baseStatus, hasOppositePosition: false };
    }

    return {
      ...baseStatus,
      hasOppositePosition: true,
      outcome: oppositePosition.outcome,
      ...(toFiniteNumber(oppositePosition.size) === null ? {} : { size: toFiniteNumber(oppositePosition.size)! }),
      ...(toFiniteNumber(oppositePosition.currentValue) === null
        ? {}
        : { currentValue: toFiniteNumber(oppositePosition.currentValue)! }),
      ...(toFiniteNumber(oppositePosition.avgPrice) === null ? {} : { avgPrice: toFiniteNumber(oppositePosition.avgPrice)! }),
      ...(toFiniteNumber(oppositePosition.curPrice) === null ? {} : { curPrice: toFiniteNumber(oppositePosition.curPrice)! }),
      ...(oppositePosition.title ? { title: oppositePosition.title } : {}),
      ...(oppositePosition.slug ? { slug: oppositePosition.slug } : {})
    };
  } catch (error) {
    return { ...baseStatus, hasOppositePosition: false, error: formatError(error) };
  }
}

async function fetchPolymarketPositions(url: URL): Promise<PolymarketPosition[]> {
  const response = await fetch(url.toString(), {
    headers: { "user-agent": "PolymarketResolutionMonitorBot/0.1" },
    signal: AbortSignal.timeout(positionLookupTimeoutMs)
  });
  if (!response.ok) {
    throw new Error(`Polymarket positions HTTP ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("Unexpected Polymarket positions response");
  }

  return payload.filter(isPolymarketPosition);
}

function buildPositionsUrl(address: string, conditionId: string): URL {
  const url = new URL(polymarketPositionsApiUrl);
  url.searchParams.set("user", address);
  url.searchParams.set("market", conditionId);
  url.searchParams.set("sizeThreshold", "0");
  url.searchParams.set("limit", "100");
  return url;
}

function buildPublicProfileUrl(address: string): URL {
  const url = new URL(polymarketPublicProfileApiUrl);
  url.searchParams.set("address", address);
  return url;
}

function getPolymarketProfileName(profile?: PolymarketPublicProfile, trade?: PolymarketTrade): string | undefined {
  const visibleProfileName = profile?.displayUsernamePublic === false ? undefined : profile?.name;
  return firstNonEmptyString(visibleProfileName, trade?.name, profile?.pseudonym, trade?.pseudonym) ?? undefined;
}

function buildPolymarketProfileUrl(address: string, profileName: string | undefined, displayUsernamePublic: boolean | null | undefined): string {
  if (profileName && displayUsernamePublic !== false && isSafePolymarketHandle(profileName)) {
    return `${polymarketProfileBaseUrl}/@${encodeURIComponent(profileName)}`;
  }

  return `${polymarketProfileBaseUrl}/${address}`;
}

function formatPolymarketProfileSuffix(profile: AddressProfileStatus): string {
  const linkLabel = profile.profileName ? `Polymarket: ${profile.profileName}` : "Polymarket";
  return ` ([${escapeMarkdownLinkLabel(linkLabel)}](${profile.profileUrl}))`;
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

function normalizeConditionId(conditionId: string | undefined): string | null {
  const trimmed = conditionId?.trim();
  return trimmed && conditionIdPattern.test(trimmed) ? trimmed.toLowerCase() : null;
}

function getOppositeOutcome(outcome: "YES" | "NO" | undefined): "YES" | "NO" | null {
  if (outcome === "YES") {
    return "NO";
  }
  if (outcome === "NO") {
    return "YES";
  }
  return null;
}

function normalizeOutcome(outcome: string | undefined): "YES" | "NO" | null {
  const normalized = outcome?.trim().toLowerCase();
  if (normalized === "yes" || normalized === "y") {
    return "YES";
  }
  if (normalized === "no" || normalized === "n") {
    return "NO";
  }
  return null;
}

function isPolymarketPosition(value: unknown): value is PolymarketPosition {
  return Boolean(value && typeof value === "object");
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function isSafePolymarketHandle(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,80}$/.test(value);
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/[[\]\\]/g, "\\$&");
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
