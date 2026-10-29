#!/usr/bin/env bash
# Runs the stack as systemd user services, so it outlives the terminal or agent session that started it and restarts
# on a crash. Logs go to logs/.
#
#   ./up.sh              # dev: Convex, Vite and a GPU worker (sweeping) against the local backend; restarts them all
#   ./up.sh stop         # stop the dev stack
#   ./up.sh prod         # (re)install and start the production worker (worker/.env.prod.local)
#   ./up.sh prod stop    # stop and disable it
#   systemctl --user status 'neuronaut-*'
#
# The production worker is a real unit file, enabled, so it comes back after a reboot or WSL shutdown (it refuses to
# install without `loginctl enable-linger`). It has its own name, so the dev commands never touch it. Both workers share the GPU: while
# the dev one runs, judging on prod is slower, but guesses come from the store and don't need the GPU.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$PWD

if [[ "${1:-}" == prod ]]; then
  UNIT=neuronaut-prod-worker
  systemctl --user stop "$UNIT" 2>/dev/null || true
  if [[ "${2:-}" == stop ]]; then
    systemctl --user disable "$UNIT" 2>/dev/null || true
    exit 0
  fi
  if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != yes ]]; then
    echo "Without lingering the worker won't start after a reboot until you log in. Run: sudo loginctl enable-linger $USER" >&2
    exit 1
  fi
  mkdir -p logs ~/.config/systemd/user
  cat > ~/.config/systemd/user/$UNIT.service <<UNITFILE
[Unit]
Description=Neuronaut GPU worker (production)

[Service]
WorkingDirectory=$ROOT/worker
EnvironmentFile=$ROOT/worker/.env.prod.local
Environment="PATH=$PATH" "HOME=$HOME"
ExecStart=$(command -v uv) run python main.py --sweep
Restart=always
RestartSec=10
StandardOutput=append:$ROOT/logs/prod-worker.log
StandardError=append:$ROOT/logs/prod-worker.log

[Install]
WantedBy=default.target
UNITFILE
  systemctl --user daemon-reload
  systemctl --user enable --now "$UNIT"
  systemctl --user --no-pager status "$UNIT" | head -3
  exit 0
fi

UNITS=(neuronaut-convex neuronaut-vite neuronaut-worker)

for u in "${UNITS[@]}"; do
  systemctl --user stop "$u" 2>/dev/null || true
  systemctl --user reset-failed "$u" 2>/dev/null || true
done
# a stopped transient unit lingers for a moment; starting one with the same name before it's gone fails
for _ in $(seq 40); do
  systemctl --user list-units --all --no-legend "${UNITS[@]}" | grep -q . || break
  sleep 0.5
done
[[ "${1:-}" == stop ]] && exit 0

mkdir -p logs
run() {  # unit, working dir, command...
  local unit=$1 dir=$2
  shift 2
  systemd-run --user --quiet --unit="$unit" --working-directory="$dir" \
    --property=Restart=on-failure --property=RestartSec=10 \
    --property=StandardOutput="append:$ROOT/logs/${unit#neuronaut-}.log" \
    --property=StandardError="append:$ROOT/logs/${unit#neuronaut-}.log" \
    --setenv=PATH="$PATH" --setenv=HOME="$HOME" "$@"
}

run neuronaut-convex "$ROOT" env CONVEX_AGENT_MODE=anonymous CONVEX_TMPDIR="$ROOT/.tmp" bunx convex dev --tail-logs always
run neuronaut-vite "$ROOT" bunx vite --port 5173 --host 127.0.0.1
run neuronaut-worker "$ROOT/worker" bash -c "set -a; . ./.env.local; set +a; exec uv run python main.py --sweep"
systemctl --user --no-pager list-units 'neuronaut-*'
