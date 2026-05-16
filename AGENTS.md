Keep changes small and focused.
Do not rewrite unrelated files.
Prefer TypeScript strict mode.
Use README.md "Agent Quick Context" as the compact project map before making integration changes.
Add new website integrations as adapters only.
Copy the Bonbast adapter pattern for new websites.
Do not add one-off Discord UI per integration; keep display formatting centralized in src/embeds.ts.
Every integration should define commandName, defaultChannelName, alertRoleName, and alertRoleEmoji.
Every integration should appear in README.md "Current Integrations" with one short row.
Keep timestamps in SQLite as ISO strings and format them only for Discord output.
Add adapter parsing tests and registry/command tests for every new integration.
Do not add trading automation unless explicitly requested.
Before editing, inspect existing adapter patterns.
Run targeted tests before broad tests.
