# Architecture

This bot is a registry-driven Discord monitor. Integrations fetch and normalize public source data; the shared runtime stores state, detects meaningful changes, and renders Discord alerts. It does not trade.

## Runtime Flow

```text
src/integrations/registry.ts
  -> WebsiteAdapter
  -> IntegrationProvisioner
  -> SQLite integration row
  -> PollScheduler
  -> shared Discord embeds and role mentions
```

1. `src/integrations/registry.ts` indexes adapters by id and command name. Registry construction rejects duplicate or malformed metadata at startup.
2. `src/provisioner.ts` creates or reconciles monitor channels, roles, and SQLite integration rows.
3. `src/poller.ts` schedules source checks, activates queued Polymarket URLs, compares normalized values, stores checks, and dispatches alerts.
4. `src/embeds.ts` owns shared Discord presentation. Adapters return data; they do not build one-off Discord layouts.
5. `src/database.ts` persists monitor values, settings, timestamps, snapshots, update logs, market-end metadata, and role metadata.

## Responsibility Map

| Concern | Primary file |
| --- | --- |
| Adapter contracts and result types | `src/integrations/types.ts` |
| Adapter registration and metadata validation | `src/integrations/registry.ts` |
| Website parsing and source-specific polling | `src/integrations/<name>.ts` |
| Generic slash commands | `src/commands.ts` |
| Channel and role provisioning | `src/provisioner.ts` |
| Polling, deduplication, and alert dispatch | `src/poller.ts` |
| Error classification and persisted notice state | `src/errorNotices.ts` |
| Shared Discord UI | `src/embeds.ts` |
| SQLite persistence | `src/database.ts` |
| Polymarket market queues and rollover | `src/polymarketQueue.ts` |
| Gamma market-end lookup | `src/marketEnd.ts` |
| Safe adapter settings JSON helpers | `src/settingsJson.ts` |
| SGT/ET display formatting | `src/time.ts` |
| Pi process heartbeat | `src/botStatus.ts` |

## State Rules

- SQLite timestamps stay as ISO strings. Convert them to ET or SGT only at the Discord display boundary.
- `lastValue` is the normalized comparison key, not necessarily every field returned by a source.
- `settingsJson` is adapter-owned state. Shared keys must use helpers in `src/settingsJson.ts`.
- Event monitors deduplicate by post/event id and retain a bounded seen-id list.
- Market rollover is separate from source-value change. A new market becomes the baseline instead of creating a false value-change alert.
- Missing or expired Polymarket markets must not stop resolution-source monitoring unless an adapter explicitly requires a market window.

## Change Boundaries

- Add websites as adapters; do not put source scraping in commands, poller, or embeds.
- Add generic Discord behavior centrally rather than branching per adapter in command handlers.
- Keep human-facing alert formatting in `src/embeds.ts`.
- Extract cohesive helpers when `commands.ts`, `embeds.ts`, or `poller.ts` gains a reusable responsibility; avoid broad rewrites.
- Treat the Current Integrations table in `README.md` as operator-facing metadata. `test/documentation.test.ts` verifies it against the registry.

## Validation

Run the smallest relevant tests first, then the full gate:

```powershell
npm.cmd test -- <adapter-or-module>
npm.cmd run validate
```

`npm run validate` runs strict TypeScript compilation followed by the full Vitest suite.
Vitest uses one forked worker because the large suite can crash the Windows Node process when native dependencies are loaded through the thread pool.
