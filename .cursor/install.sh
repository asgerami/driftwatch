#!/usr/bin/env bash
# Cloud Agent install phase: durable, idempotent repository setup.
#
# Runs once after the repository is checked out (and once when a prebuilt
# environment build creates its baseline snapshot). It must terminate and must
# be safe to run repeatedly. Per-boot work (starting Postgres, applying the
# schema) lives in start.sh instead.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "install: system packages (docker engine + fuse-overlayfs + psql client)"
# fuse-overlayfs lets dockerd run inside the Cloud Agent VM without a host
# overlay mount. --force-confold keeps existing conffiles so the fuse3
# /etc/fuse.conf postinst never blocks on an interactive prompt.
APT_OPTS=(-y -qq -o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef)
sudo apt-get update -qq
sudo apt-get install "${APT_OPTS[@]}" \
  docker.io docker-compose-v2 fuse3 fuse-overlayfs postgresql-client

echo "install: node toolchain"
corepack enable >/dev/null 2>&1 || true

echo "install: workspace dependencies (also builds @driftwatch/core via its prepare script)"
pnpm install --frozen-lockfile

# DATABASE_URL here points at the local Postgres container from docker-compose.yml
# and carries no secret, so it is safe to materialize from the checked-in example.
if [ ! -f .env ]; then
  echo "install: creating .env from .env.example"
  cp .env.example .env
fi

echo "install: prisma client"
pnpm generate

echo "install: done"
