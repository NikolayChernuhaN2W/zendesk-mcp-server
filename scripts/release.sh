#!/usr/bin/env bash
# Build the Claude Desktop extension (.mcpb) into dist/ and optionally
# publish it as a release on the Forgejo repo. Wraps scripts/release.mjs.
#
# Usage:
#   scripts/release.sh build   [--allow-writes | --all]
#   scripts/release.sh publish [--allow-writes | --all]
#
#   (no flag)       read-only mode on by default
#   --allow-writes  read-only mode off by default
#   --all           both variants
#
# publish uses FORGEJO_TOKEN, or asks for it if it isn't set.
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  sed -n '5,12s/^# \{0,1\}//p' "$0"
  exit "${1:-1}"
}

case "${1:-}" in
  build) base=(--build-only) ;;
  publish) base=() ;;
  -h|--help) usage 0 ;;
  *) usage ;;
esac

case "${2:-}" in
  "") variants=(read-only) ;;
  --allow-writes) variants=(writes) ;;
  --all) variants=(read-only writes) ;;
  *) usage ;;
esac
[ $# -le 2 ] || usage

if [ "$1" = publish ] && [ -z "${FORGEJO_TOKEN:-}" ]; then
  if [ ! -t 0 ]; then
    echo "release: set FORGEJO_TOKEN to publish" >&2
    exit 1
  fi
  read -rsp "Forgejo token (write:repository scope): " FORGEJO_TOKEN
  echo
  export FORGEJO_TOKEN
fi

# The packer is a dev dependency
[ -d node_modules/@anthropic-ai/mcpb ] || npm install --no-audit --no-fund

for variant in "${variants[@]}"; do
  if [ "$variant" = writes ]; then
    node scripts/release.mjs "${base[@]}" --allow-writes
  else
    node scripts/release.mjs "${base[@]}"
  fi
done
