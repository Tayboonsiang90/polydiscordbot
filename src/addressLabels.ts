import type { AddressLabelAction, AddressLabelEntry, AddressLabelUpdateResult } from "./integrations/types.js";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;

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

export function formatAddressWithLabel(address: string, labels: AddressLabelEntry[]): string {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    return address;
  }

  const label = labels.find((entry) => entry.address === normalized)?.label;
  return label ? `${label}\n${normalized}` : normalized;
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

function parseSettingsJson(settingsJson: string | null): Record<string, unknown> {
  if (!settingsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(settingsJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
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
