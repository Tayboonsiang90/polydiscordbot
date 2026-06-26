#!/usr/bin/env bash
set -u

ROOT_DIR="${BOT_ROOT:-/home/financegeek/apps/discord-bot}"
ENV_FILE="${BOT_ENV_FILE:-$ROOT_DIR/.env}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

SERVICE_NAME="${BOT_SERVICE_NAME:-${DISCORD_BOT_SERVICE:-discord-bot.service}}"
HEARTBEAT_PATH="${BOT_HEARTBEAT_PATH:-$ROOT_DIR/.health/bot-heartbeat.json}"
MAX_HEARTBEAT_AGE_SECONDS="${BOT_HEARTBEAT_MAX_AGE_SECONDS:-120}"
STATE_DIR="${BOT_WATCHDOG_STATE_DIR:-$ROOT_DIR/.health}"
STATE_FILE="$STATE_DIR/watchdog-state.env"
BOOT_ID_FILE="$STATE_DIR/watchdog-boot-id"
LOG_FILE="$STATE_DIR/watchdog.log"
WEBHOOK_USERNAME="${DISCORD_HEALTH_WEBHOOK_USERNAME:-RPi Bot Watchdog}"
STATUS_CHANNEL_NAME="${BOT_STATUS_CHANNEL_NAME:-bot-status}"
HEALTHCHECKS_PING_URL="${HEALTHCHECKS_PING_URL:-}"
RESTART_ON_BAD="${BOT_WATCHDOG_RESTART_ON_BAD:-true}"
RESTART_COOLDOWN_SECONDS="${BOT_WATCHDOG_RESTART_COOLDOWN_SECONDS:-300}"
RESTART_WINDOW_SECONDS="${BOT_WATCHDOG_RESTART_WINDOW_SECONDS:-900}"
MAX_RESTARTS_PER_WINDOW="${BOT_WATCHDOG_MAX_RESTARTS_PER_WINDOW:-3}"

read_heartbeat_summary() {
  python3 - "$1" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text())
parts = [
    f"heartbeatAt={data.get('heartbeatAt', 'unknown')}",
    f"commit={data.get('commit', 'unknown')}",
    f"pid={data.get('pid', 'unknown')}",
    f"uptime={data.get('uptimeSeconds', 'unknown')}s",
]
print(", ".join(parts))
PY
}

build_description() {
  local title="$1"
  local current_status="$2"
  local heartbeat="$3"
  local errors="$4"
  local issue_text="none"
  if [ "${#issues[@]}" -gt 0 ]; then
    issue_text="$(printf -- '- %s\n' "${issues[@]}")"
  fi

  cat <<EOF
**$title**

Host: $(hostname)
Time: $now_iso
Service: $SERVICE_NAME = $service_status
Status: $current_status
Repo commit: $current_commit
Heartbeat: $heartbeat
VPN/Public IP: $(curl -4s --connect-timeout 5 https://ifconfig.me 2>/dev/null || echo unknown)

Issues:
$issue_text
Recent critical service logs:
\`\`\`
$(printf '%s' "${errors:-none}" | tail -c 2500)
\`\`\`
EOF
}

send_webhook() {
  local title="$1"
  local color="$2"
  local description="$3"
  if [ -n "${DISCORD_HEALTH_WEBHOOK_URL:-}" ]; then
    local payload
    payload="$(
      WEBHOOK_USERNAME="$WEBHOOK_USERNAME" TITLE="$title" COLOR="$color" DESCRIPTION="$description" python3 <<'PY'
import json
import os

print(json.dumps({
    "username": os.environ["WEBHOOK_USERNAME"],
    "embeds": [{
        "title": os.environ["TITLE"],
        "description": os.environ["DESCRIPTION"][:3900],
        "color": int(os.environ["COLOR"]),
    }],
}))
PY
    )"

    curl -fsS --connect-timeout 10 --max-time 20 \
      -H "Content-Type: application/json" \
      -d "$payload" \
      "$DISCORD_HEALTH_WEBHOOK_URL" >/dev/null
    return $?
  fi

  send_discord_bot_message "$title" "$color" "$description"
}

send_discord_bot_message() {
  local title="$1"
  local color="$2"
  local description="$3"
  if [ -z "${DISCORD_TOKEN:-}" ] || [ -z "${DISCORD_GUILD_ID:-}" ]; then
    echo "DISCORD_HEALTH_WEBHOOK_URL is not set and DISCORD_TOKEN/DISCORD_GUILD_ID are unavailable; would send: $title" >&2
    return 0
  fi

  TITLE="$title" COLOR="$color" DESCRIPTION="$description" STATUS_CHANNEL_NAME="$STATUS_CHANNEL_NAME" python3 <<'PY'
import json
import os
import urllib.error
import urllib.request

api = "https://discord.com/api/v10"
token = os.environ["DISCORD_TOKEN"]
guild_id = os.environ["DISCORD_GUILD_ID"]
channel_name = os.environ["STATUS_CHANNEL_NAME"]

headers = {
    "Authorization": f"Bot {token}",
    "Content-Type": "application/json",
    "User-Agent": "GuangdangBotWatchdog/1.0",
}

def request(method, path, payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(f"{api}{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=20) as response:
        body = response.read()
        return json.loads(body.decode("utf-8")) if body else None

channels = request("GET", f"/guilds/{guild_id}/channels")
channel = next((item for item in channels if item.get("type") == 0 and item.get("name") == channel_name), None)
if channel is None:
    channel = request("POST", f"/guilds/{guild_id}/channels", {
        "name": channel_name,
        "type": 0,
        "topic": "Runtime health, restarts, and watchdog alerts for Guangdang Bot.",
    })

request("POST", f"/channels/{channel['id']}/messages", {
    "embeds": [{
        "title": os.environ["TITLE"],
        "description": os.environ["DESCRIPTION"][:3900],
        "color": int(os.environ["COLOR"]),
    }],
})
PY
}

send_healthchecks_ping() {
  if [ -z "$HEALTHCHECKS_PING_URL" ]; then
    return 0
  fi

  local base_url="${HEALTHCHECKS_PING_URL%/}"
  if [ "$status" = "ok" ]; then
    curl -fsS --connect-timeout 10 --max-time 20 "$base_url" >/dev/null || true
    return 0
  fi

  build_description "Bot unhealthy" "$status" "$heartbeat_summary" "$critical_errors" |
    curl -fsS --connect-timeout 10 --max-time 20 --data-binary @- "$base_url/fail" >/dev/null || true
}

restart_bot_service() {
  if [ -n "${BOT_RESTART_COMMAND:-}" ]; then
    sh -c "$BOT_RESTART_COMMAND"
    return $?
  fi

  sudo -n systemctl restart "$SERVICE_NAME"
}

mkdir -p "$STATE_DIR"

previous_status="unknown"
previous_check_epoch="$(date -d '10 minutes ago' +%s)"
if [ -f "$STATE_FILE" ]; then
  # shellcheck disable=SC1090
  . "$STATE_FILE"
fi
last_restart_epoch="${last_restart_epoch:-0}"
restart_window_epoch="${restart_window_epoch:-0}"
restart_count="${restart_count:-0}"

now_epoch="$(date +%s)"
now_iso="$(date -Is)"
boot_id="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo unknown)"
last_boot_id="$(cat "$BOOT_ID_FILE" 2>/dev/null || true)"
current_commit="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
issues=()

service_status="$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || true)"
if [ "$service_status" != "active" ]; then
  issues+=("systemd service is $service_status")
fi

heartbeat_summary="missing"
if [ ! -f "$HEARTBEAT_PATH" ]; then
  issues+=("heartbeat file is missing: $HEARTBEAT_PATH")
else
  heartbeat_mtime="$(stat -c %Y "$HEARTBEAT_PATH" 2>/dev/null || echo 0)"
  heartbeat_age=$((now_epoch - heartbeat_mtime))
  heartbeat_summary="$(read_heartbeat_summary "$HEARTBEAT_PATH" 2>/dev/null || echo "mtime age ${heartbeat_age}s")"
  if [ "$heartbeat_age" -gt "$MAX_HEARTBEAT_AGE_SECONDS" ]; then
    issues+=("heartbeat is stale: ${heartbeat_age}s old, max ${MAX_HEARTBEAT_AGE_SECONDS}s")
  fi
fi

critical_errors="$(
  journalctl -u "$SERVICE_NAME" -b --since "@$previous_check_epoch" --no-pager 2>/dev/null |
    grep -Ei "Discord login failed|Bot startup failed|Unhandled promise rejection|Uncaught exception|Captured uncaught exception|Main process exited|Failed with result|Killed process|Out of memory|FATAL|panic" |
    tail -n 20 || true
)"

status="ok"
if [ "${#issues[@]}" -gt 0 ]; then
  status="bad"
fi

send_healthchecks_ping

restart_summary="not attempted"
restart_alert_needed="false"
if [ "$status" = "bad" ] && [ "$RESTART_ON_BAD" = "true" ]; then
  if [ $((now_epoch - restart_window_epoch)) -gt "$RESTART_WINDOW_SECONDS" ]; then
    restart_window_epoch="$now_epoch"
    restart_count=0
  fi

  if [ $((now_epoch - last_restart_epoch)) -lt "$RESTART_COOLDOWN_SECONDS" ]; then
    restart_summary="skipped; cooldown active for $((RESTART_COOLDOWN_SECONDS - (now_epoch - last_restart_epoch)))s"
  elif [ "$restart_count" -ge "$MAX_RESTARTS_PER_WINDOW" ]; then
    restart_summary="suppressed; $restart_count restart(s) already attempted in the last ${RESTART_WINDOW_SECONDS}s"
    restart_alert_needed="true"
  elif restart_bot_service; then
    last_restart_epoch="$now_epoch"
    restart_count=$((restart_count + 1))
    restart_summary="restart command succeeded for $SERVICE_NAME"
    restart_alert_needed="true"
  else
    last_restart_epoch="$now_epoch"
    restart_count=$((restart_count + 1))
    restart_summary="restart command failed for $SERVICE_NAME; check sudo/systemd permissions"
    restart_alert_needed="true"
  fi
elif [ "$status" = "bad" ]; then
  restart_summary="disabled by BOT_WATCHDOG_RESTART_ON_BAD=$RESTART_ON_BAD"
fi

message_status="$status; restart: $restart_summary"
message_sent="true"
if [ "$boot_id" != "$last_boot_id" ]; then
  if send_webhook "RPi bot host booted" 3447003 "$(build_description "Boot detected" "$message_status" "$heartbeat_summary" "$critical_errors")"; then
    echo "$boot_id" > "$BOOT_ID_FILE"
  else
    message_sent="false"
  fi
fi

if [ "$restart_alert_needed" = "true" ]; then
  if ! send_webhook "Discord bot watchdog restart" 16753920 "$(build_description "Watchdog restart action" "$message_status" "$heartbeat_summary" "$critical_errors")"; then
    message_sent="false"
  fi
fi

if [ "$status" = "bad" ] && [ "$previous_status" != "bad" ]; then
  if ! send_webhook "Discord bot watchdog alert" 15158332 "$(build_description "Bot unhealthy" "$message_status" "$heartbeat_summary" "$critical_errors")"; then
    message_sent="false"
  fi
fi

if [ "$status" = "ok" ] && [ "$previous_status" = "bad" ]; then
  if ! send_webhook "Discord bot recovered" 3066993 "$(build_description "Bot healthy again" "$message_status" "$heartbeat_summary" "$critical_errors")"; then
    message_sent="false"
  fi
fi

if [ "$message_sent" = "true" ]; then
  cat > "$STATE_FILE" <<EOF
previous_status="$status"
previous_check_epoch="$now_epoch"
last_restart_epoch="$last_restart_epoch"
restart_window_epoch="$restart_window_epoch"
restart_count="$restart_count"
EOF
else
  cat > "$STATE_FILE" <<EOF
previous_status="$previous_status"
previous_check_epoch="$previous_check_epoch"
last_restart_epoch="$last_restart_epoch"
restart_window_epoch="$restart_window_epoch"
restart_count="$restart_count"
EOF
fi

printf '%s status=%s service=%s heartbeat=%s restart=%s\n' "$now_iso" "$status" "$service_status" "$heartbeat_summary" "$restart_summary" >> "$LOG_FILE"
