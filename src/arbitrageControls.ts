import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import type { ArbitrageSetupResult, ArbitrageWatchSide, Integration } from "./integrations/types.js";

type ArbitrageSelectStage = "outcome" | "side";

const customIdPrefix = "arb-select";

export function buildArbitrageOutcomeSelectRow(
  integration: Integration,
  result: ArbitrageSetupResult
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  if (!result.outcomes.length) {
    return [];
  }

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(buildArbitrageSelectCustomId(integration.id, "outcome"))
        .setPlaceholder("Choose outcome")
        .addOptions(
          result.outcomes.slice(0, 25).map((outcome, index) => ({
            label: truncateSelectText(outcome.label, 100),
            description: truncateSelectText(outcome.platformLabels.join(" / "), 100),
            value: String(index)
          }))
        )
    )
  ];
}

export function buildArbitrageSideSelectRow(integration: Integration): ActionRowBuilder<StringSelectMenuBuilder>[] {
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(buildArbitrageSelectCustomId(integration.id, "side"))
        .setPlaceholder("Choose side")
        .addOptions(
          { label: "YES", description: "Monitor YES routes and hedged packages.", value: "YES" },
          { label: "NO", description: "Monitor NO routes and hedged packages.", value: "NO" },
          { label: "BOTH", description: "Monitor YES, NO, and hedged package routes.", value: "BOTH" }
        )
    )
  ];
}

export function buildArbitrageSelectCustomId(integrationId: number, stage: ArbitrageSelectStage): string {
  return `${customIdPrefix}:${integrationId}:${stage}`;
}

export function parseArbitrageSelectCustomId(value: string): { integrationId: number; stage: ArbitrageSelectStage } | null {
  const [prefix, integrationIdText, stage] = value.split(":");
  if (prefix !== customIdPrefix || (stage !== "outcome" && stage !== "side")) {
    return null;
  }

  const integrationId = Number(integrationIdText);
  if (!Number.isInteger(integrationId) || integrationId < 1) {
    return null;
  }

  return { integrationId, stage };
}

export function parseArbitrageWatchSide(value: string): ArbitrageWatchSide | null {
  return value === "YES" || value === "NO" || value === "BOTH" ? value : null;
}

function truncateSelectText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}
