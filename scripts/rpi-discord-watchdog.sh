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

SERVICE_NAME="${DISCORD_BOT_SERVICE:-discord-bot.service}"
HEARTBEAT_PATH="${BOT_HEARTBEAT_PATH:-$ROOT_DIR/.health/bot-heartbeat.json}"
MAX_HEARTBEAT_AGE_SECONDS="${BOT_HEARTBEAT_MAX_AGE_SECONDS:-900}"
STATE_DIR="${BOT_WATCHDOG_STATE_DIR:-$ROOT_DIR/.health}"
STATE_FILE="$STATE_DIR/watchdog-state.env"
BOOT_ID_FILE="$STATE_DIR/watchdog-boot-id"
LOG_FILE="$STATE_DIR/watchdog.log"
WEBHOOK_USERNAME="${DISCORD_HEALTH_WEBHOOK_USERNAME:-RPi Bot Watchdog}"
HEALTHCHECKS_PING_URL="${HEALTHCHECKS_PING_URL:-}"

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
Recent service errors:
\`\`\`
$(printf '%s' "${errors:-none}" | tail -c 2500)
\`\`\`
EOF
}

send_webhook() {
  local title="$1"
  local color="$2"
  local description="$3"
  if [ -z "${DISCORD_HEALTH_WEBHOOK_URL:-}" ]; then
    echo "DISCORD_HEALTH_WEBHOOK_URL is not set; would send: $title" >&2
    return 0
  fi

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

  build_description "Bot unhealthy" "$status" "$heartbeat_summary" "$recent_errors" |
    curl -fsS --connect-timeout 10 --max-time 20 --data-binary @- "$base_url/fail" >/dev/null || true
}

mkdir -p "$STATE_DIR"

previous_status="unknown"
previous_check_epoch="$(date -d '10 minutes ago' +%s)"
if [ -f "$STATE_FILE" ]; then
  # shellcheck disable=SC1090
  . "$STATE_FILE"
fi

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

recent_errors="$(
  journalctl -u "$SERVICE_NAME" -b --since "@$previous_check_epoch" --no-pager 2>/dev/null |
    grep -Ei "Discord login failed|Bot startup failed|Unhandled promise rejection|Uncaught exception|Captured uncaught exception|Main process exited|Failed with result|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|Connect Timeout Error" |
    tail -n 20 || true
)"

status="ok"
if [ "${#issues[@]}" -gt 0 ]; then
  status="bad"
fi

send_healthchecks_ping

message_sent="true"
if [ "$boot_id" != "$last_boot_id" ]; then
  if ! send_webhook "RPi bot host booted" 3447003 "$(build_description "Boot detected" "$status" "$heartbeat_summary" "$recent_errors")"; then
    message_sent="false"
  else
    echo "$boot_id" > "$BOOT_ID_FILE"
  fi
fi

if [ -n "$recent_errors" ]; then
  if ! send_webhook "Discord bot runtime errors detected" 16753920 "$(build_description "Recent bot errors" "$status" "$heartbeat_summary" "$recent_errors")"; then
    message_sent="false"
  fi
fi

if [ "$status" = "bad" ] && [ "$previous_status" != "bad" ]; then
  if ! send_webhook "Discord bot watchdog alert" 15158332 "$(build_description "Bot unhealthy" "$status" "$heartbeat_summary" "$recent_errors")"; then
    message_sent="false"
  fi
fi

if [ "$status" = "ok" ] && [ "$previous_status" = "bad" ]; then
  if ! send_webhook "Discord bot recovered" 3066993 "$(build_description "Bot healthy again" "$status" "$heartbeat_summary" "$recent_errors")"; then
    message_sent="false"
  fi
fi

if [ "$message_sent" = "true" ]; then
  cat > "$STATE_FILE" <<EOF
previous_status="$status"
previous_check_epoch="$now_epoch"
EOF
fi

printf '%s status=%s service=%s heartbeat=%s\n' "$now_iso" "$status" "$service_status" "$heartbeat_summary" >> "$LOG_FILE"
