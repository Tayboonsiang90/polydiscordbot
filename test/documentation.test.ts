import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listAdapters } from "../src/integrations/registry.js";

type ReadmeIntegrationRow = {
  id: string;
  commandName: string;
  defaultChannelName: string;
  alertRoleName: string;
  alertRoleEmoji: string;
};

function readCurrentIntegrationRows(): ReadmeIntegrationRow[] {
  const markdown = readFileSync("README.md", "utf8");
  const rows: ReadmeIntegrationRow[] = [];
  const rowPattern = /^\| `([^`]+)` \| `\/([^`]+)` \| `#([^`]+)` \| `([^`]+)` \| `([^`]+)` \| .+ \|$/gm;
  for (const match of markdown.matchAll(rowPattern)) {
    rows.push({
      id: match[1],
      commandName: match[2],
      defaultChannelName: match[3],
      alertRoleName: match[4],
      alertRoleEmoji: match[5]
    });
  }
  return rows;
}

describe("README integration documentation", () => {
  it("matches adapter registry metadata", () => {
    const rows = readCurrentIntegrationRows();
    const rowById = new Map(rows.map((row) => [row.id, row]));

    expect(rows).toHaveLength(listAdapters().length);
    for (const adapter of listAdapters()) {
      expect(rowById.get(adapter.id)).toEqual({
        id: adapter.id,
        commandName: adapter.commandName,
        defaultChannelName: adapter.defaultChannelName,
        alertRoleName: adapter.alertRoleName,
        alertRoleEmoji: adapter.alertRoleEmoji
      });
    }
  });
});
