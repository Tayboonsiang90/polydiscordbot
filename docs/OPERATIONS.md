# Raspberry Pi Operations

Production runs from `/home/financegeek/apps/discord-bot` on the Raspberry Pi.

## Process Layout

- `discord-bot.service` runs Guangdang Bot through `npm run dev`.
- User cron runs `deploy.sh` every minute. It pulls `origin/main`, builds, registers commands, and restarts the service only when the remote commit changes.
- User cron also runs `scripts/rpi-discord-watchdog.sh` every minute.
- The bot writes `.health/bot-heartbeat.json`; the watchdog restarts a stale or inactive service.

## Discord Health Policy

- `#bot-status`: startup, recovery, stale/missing heartbeat, inactive service, restart result, and fatal runtime errors.
- `#errorlogs`: integration source/check failures. One editable failure message is retained per integration.
- Normal transient retry noise stays in `journalctl` and `.health/watchdog.log`.

The watchdog cannot report when the entire Pi or its internet connection is offline. Configure `HEALTHCHECKS_PING_URL` with an external dead-man check for that case.

## Required Health Settings

```bash
BOT_HEARTBEAT_PATH=.health/bot-heartbeat.json
BOT_HEARTBEAT_INTERVAL_SECONDS=30
BOT_STATUS_CHANNEL_NAME=bot-status
BOT_SERVICE_NAME=discord-bot.service
BOT_HEARTBEAT_MAX_AGE_SECONDS=120
BOT_WATCHDOG_RESTART_ON_BAD=true
BOT_WATCHDOG_RESTART_COOLDOWN_SECONDS=300
BOT_WATCHDOG_RESTART_WINDOW_SECONDS=900
BOT_WATCHDOG_MAX_RESTARTS_PER_WINDOW=3
BOT_RESTART_COMMAND=
DISCORD_HEALTH_WEBHOOK_URL=
HEALTHCHECKS_PING_URL=https://hc-ping.com/your-uuid
```

If `BOT_RESTART_COMMAND` is empty, the watchdog uses `sudo -n systemctl restart discord-bot.service`. The `financegeek` user therefore needs a narrowly scoped passwordless sudo rule for that exact restart command.

## Install Watchdog Cron

```bash
cd /home/financegeek/apps/discord-bot
mkdir -p .health
chmod +x scripts/rpi-discord-watchdog.sh
(crontab -l 2>/dev/null | grep -v 'rpi-discord-watchdog.sh'; echo '* * * * * cd /home/financegeek/apps/discord-bot && ./scripts/rpi-discord-watchdog.sh >> .health/watchdog-cron.log 2>&1') | crontab -
```

## Daily Commands

```bash
cd /home/financegeek/apps/discord-bot

# Service and process health.
systemctl status discord-bot.service --no-pager -l
cat .health/bot-heartbeat.json

# Recent and live bot logs.
journalctl -u discord-bot.service -n 120 --no-pager
journalctl -u discord-bot.service -f

# Auto-deploy and watchdog logs.
tail -n 80 deploy.log
tail -n 80 .health/watchdog.log
tail -n 80 .health/watchdog-cron.log

# Deployed code and local changes.
git rev-parse --short HEAD
git log -1 --oneline
git status --short

# Manual restart and watchdog check.
sudo systemctl restart discord-bot.service
./scripts/rpi-discord-watchdog.sh
```

## Deployment Check

When GitHub has a new commit but the Pi did not restart:

```bash
cd /home/financegeek/apps/discord-bot
git fetch origin main
git rev-parse --short HEAD
git rev-parse --short origin/main
tail -n 120 deploy.log
git status --short
```

If `HEAD` differs from `origin/main`, inspect local modifications before pulling. Do not run `git reset --hard` until every local `.env`, deploy script, and uncommitted source change has been identified. Runtime files such as `.env`, `deploy.sh`, and `deploy.log` should remain untracked.

After a clean fast-forward:

```bash
git pull --ff-only origin main
npm ci
npm run validate
npm run register-commands
sudo systemctl restart discord-bot.service
```

Confirm the startup commit:

```bash
sleep 10
journalctl -u discord-bot.service -n 60 --no-pager | grep -Ei "Logged in|commit"
```

## Failure Triage

1. Check `systemctl status` and the heartbeat file.
2. Check the latest `journalctl` entries.
3. Check free disk, memory, and Pi throttling:

   ```bash
   df -h
   free -h
   vcgencmd get_throttled
   ```

4. If many integrations fail together with timeouts or `EAI_AGAIN`, investigate VPN, DNS, or router connectivity before changing adapters.
5. If only one source fails, use `/monitor check` in that channel and inspect its single message in `#errorlogs`.
