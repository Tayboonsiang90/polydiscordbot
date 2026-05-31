import type { BotDatabase } from "./database.js";
import { getAdapter } from "./integrations/registry.js";
import type { AddressLabelAction, AddressLabelUpdateOptions } from "./integrations/types.js";

export async function syncUmaAddressLabels(
  database: BotDatabase,
  guildId: string,
  sourceIntegrationId: number,
  action: AddressLabelAction,
  addressQuery?: string,
  labelQuery?: string,
  options?: AddressLabelUpdateOptions
): Promise<number> {
  let syncedCount = 1;
  for (const integration of database.listIntegrations()) {
    if (integration.guildId !== guildId || integration.id === sourceIntegrationId) {
      continue;
    }

    const adapter = getAdapter(integration.adapterId);
    if (!adapter.updateAddressLabels) {
      continue;
    }

    const result = await adapter.updateAddressLabels(integration, action, addressQuery, labelQuery, options);
    if (result.settingsJson !== integration.settingsJson) {
      database.setSettingsJson(integration.id, result.settingsJson);
    }
    syncedCount += 1;
  }

  return syncedCount;
}
