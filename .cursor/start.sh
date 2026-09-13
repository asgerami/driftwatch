#!/usr/bin/env bash
# Cloud Agent start phase: per-boot runtime reconciliation.
#
# Brings up the Postgres the DB-backed commands need and applies the schema.
# Must tolerate restarts, avoid duplicate daemons, check readiness, then return
# so the agent can begin work. Dependency installation and code generation
# belong in install.sh, not here.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "start: ensuring docker daemon is running"
if ! sudo docker info >/dev/null 2>&1; then
  # No systemd in the VM, so launch dockerd directly. fuse-overlayfs is the
  # storage driver that works inside the nested container. setsid --fork
  # detaches it into its own session so it survives after this script returns
  # (a plain background job is reaped when the start phase's process group ends).
  sudo bash -c 'setsid --fork dockerd --storage-driver=fuse-overlayfs >/var/log/driftwatch-dockerd.log 2>&1 </dev/null'
  for _ in $(seq 1 30); do
    sudo docker info >/dev/null 2>&1 && break
    sleep 1
  done
  sudo docker info >/dev/null 2>&1 || { echo "start: dockerd failed to come up"; sudo tail -n 40 /var/log/driftwatch-dockerd.log || true; exit 1; }
fi

echo "start: bringing up Postgres (docker compose)"
sudo docker compose up -d

echo "start: waiting for Postgres to report healthy"
for _ in $(seq 1 40); do
  status="$(sudo docker inspect --format '{{.State.Health.Status}}' driftwatch-pg 2>/dev/null || echo none)"
  [ "$status" = "healthy" ] && break
  sleep 2
done
[ "$status" = "healthy" ] || { echo "start: Postgres did not become healthy (last status: $status)"; exit 1; }

echo "start: applying Prisma schema (idempotent)"
set -a
# shellcheck disable=SC1091
. ./.env
set +a
pnpm db:push

echo "start: ready — Postgres on :5433, schema in sync"
