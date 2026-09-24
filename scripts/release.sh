#!/usr/bin/env bash
# Release the extension, or build it into dist/. A release is a version tag
# on main: GitHub Actions builds and publishes it when the tag is pushed.
#
# Usage:
#   scripts/release.sh [patch | minor | major | X.Y.Z] [--yes]
#   scripts/release.sh build [--allow-writes | --all]
#
#   patch            tag the next patch version after the latest v* (default)
#   minor, major     tag the next minor or major version instead
#   X.Y.Z            tag exactly this version, which must be newer than the latest
#   --yes            don't ask for confirmation
#   build            build dist/*.mcpb: (no flag) read-only mode on by
#                    default, --allow-writes off by default, --all both
#
# The first release, when there are no v* tags yet, uses package.json's version.
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  sed -n '5,14s/^# \{0,1\}//p' "$0"
  exit "${1:-1}"
}

fail() {
  echo "release: $*" >&2
  exit 1
}

# Runs a snippet with the release-lib.mjs helpers in scope. An Error thrown by
# it is printed as "release: <message>" and exits 1.
release_lib() {
  local snippet=$1
  shift
  node --input-type=module -e "
    import * as lib from './scripts/release-lib.mjs';
    import { readFileSync } from 'node:fs';
    const args = process.argv.slice(1);
    try { $snippet }
    catch (error) { console.error('release: ' + error.message); process.exit(1); }
  " "$@"
}

build() {
  local variants
  case "${1:-}" in
    "") variants=(read-only) ;;
    --allow-writes) variants=(writes) ;;
    --all) variants=(read-only writes) ;;
    *) usage ;;
  esac

  # The packer is a dev dependency
  [ -d node_modules/@anthropic-ai/mcpb ] || npm install --no-audit --no-fund

  for variant in "${variants[@]}"; do
    if [ "$variant" = writes ]; then
      node scripts/release.mjs --allow-writes
    else
      node scripts/release.mjs
    fi
  done
}

# https://github.com/<owner>/<repo> for a GitHub origin, nothing otherwise
github_url() {
  local remote
  remote=$(git remote get-url origin 2>/dev/null) || return 0
  if [[ $remote =~ ^(https://github\.com/|git@github\.com:)([^/]+/[^/]+)$ ]]; then
    echo "https://github.com/${BASH_REMATCH[2]%.git}"
  fi
}

release() {
  local arg="" yes=false
  for option in "$@"; do
    case "$option" in
      --yes) yes=true ;;
      *) [ -z "$arg" ] || usage; arg=$option ;;
    esac
  done

  # Check the argument first, so a typo gets a precise error: "kind <kind>" or
  # "version <X.Y.Z>"
  local kind=patch explicit="" parsed
  if [ -n "$arg" ]; then
    parsed=$(release_lib "
      const [arg] = args;
      if (/^v?\d/.test(arg)) console.log('version ' + lib.parseVersion(arg));
      else { lib.nextVersion('0.0.0', arg); console.log('kind ' + arg); }
    " "$arg") || exit 1
    case "$parsed" in
      kind\ *) kind=${parsed#kind } ;;
      version\ *) explicit=${parsed#version } ;;
    esac
  fi

  # 1. Only an up-to-date, clean main can be released
  local branch changes ahead behind
  branch=$(git symbolic-ref --short -q HEAD || true)
  [ "$branch" = main ] || fail "releases are tagged from main only; switch to main (git switch main) and pull first"
  changes=$(git status --porcelain) || fail "couldn't read the working tree status"
  [ -z "$changes" ] || fail "the working tree has uncommitted changes; commit or stash them first"
  git fetch --quiet origin main --tags || fail "couldn't fetch origin"
  ahead=$(git rev-list --count origin/main..HEAD) || fail "couldn't compare main with origin/main"
  behind=$(git rev-list --count HEAD..origin/main) || fail "couldn't compare main with origin/main"
  [ "$ahead" -eq 0 ] || fail "main has $ahead commit(s) that aren't on origin/main; push them through a PR first"
  [ "$behind" -eq 0 ] || fail "main is $behind commit(s) behind origin/main; run git pull first"

  # 2. The version: the tag is the version, so work it out from the tags
  local tags plan latest version
  tags=$(git tag -l 'v*') || fail "couldn't list the tags"
  plan=$(release_lib "
    const [tags, kind, explicit] = args;
    const latest = lib.latestVersion(tags.split('\n').filter(Boolean));
    let next;
    if (explicit) {
      if (latest && lib.compareVersions(explicit, latest) <= 0) {
        throw new Error('v' + explicit + ' is not newer than the latest release v' + latest);
      }
      next = explicit;
    } else if (latest) {
      next = lib.nextVersion(latest, kind);
    } else {
      next = lib.parseVersion(JSON.parse(readFileSync('package.json', 'utf8')).version);
    }
    console.log((latest || '-') + ' ' + next);
  " "$tags" "$kind" "$explicit") || exit 1
  latest=${plan%% *}
  version=${plan#* }
  [ "$latest" != - ] || latest=""

  # 3. The tag must be new, here and on origin
  local name="v$version" remote_tag
  ! git rev-parse -q --verify "refs/tags/$name" >/dev/null || fail "tag $name already exists locally"
  remote_tag=$(git ls-remote --tags origin "refs/tags/$name") || fail "couldn't reach origin to check for tag $name"
  [ -z "$remote_tag" ] || fail "tag $name already exists on origin"

  # 4. There must be something to release
  local count
  if [ -n "$latest" ]; then
    count=$(git rev-list --count "v$latest..HEAD") || fail "couldn't count the changes since v$latest"
    [ "$count" -gt 0 ] || fail "nothing to release: main has no changes since v$latest"
  fi

  # 5. The tests must pass
  npm test >/dev/null 2>&1 || fail "npm test fails; run it to see why"

  # 6. Summary
  if [ -n "$latest" ]; then
    echo "Last release: v$latest ($(TZ=UTC git for-each-ref --format='%(creatordate:format-local:%Y-%m-%d)' "refs/tags/v$latest"))"
  else
    echo "First release"
  fi
  echo "Next release: $name"
  echo "Changes:"
  if [ -n "$latest" ]; then
    git log --oneline --no-decorate "v$latest..HEAD" | sed 's/^/  /'
  else
    git log --oneline --no-decorate -20 | sed 's/^/  /'
  fi
  if node scripts/release.mjs --notes "$version" >/dev/null 2>&1; then
    echo "Release notes: from RELEASE_NOTES.md"
  else
    echo "Release notes: none written for $name, so GitHub will list the merged pull requests"
  fi

  # 7. Confirmation
  if [ "$yes" = false ]; then
    [ -t 0 ] || fail "no terminal to confirm on; pass --yes to release without asking"
    local answer=
    read -rp "Release $name? [y/N] " answer || true
    [[ $answer =~ ^[Yy]$ ]] || fail "not released"
  fi

  # 8. Tag and push only the tag
  git tag -a "$name" -m "$name" -m "Released $(date -u +%F) from $(git rev-parse HEAD)"
  if ! git push origin "$name"; then
    git tag -d "$name" >/dev/null
    fail "push failed; the local tag was removed, so you can run the release again"
  fi

  # 9. Where to watch it
  local url
  url=$(github_url)
  if [ -n "$url" ]; then
    echo "Tagged $name. GitHub Actions is building the release: $url/actions"
    echo "It will appear at $url/releases/tag/$name"
  else
    echo "Tagged $name."
  fi
}

case "${1:-}" in
  build) shift; [ $# -le 1 ] || usage; build "$@" ;;
  -h|--help) usage 0 ;;
  *) release "$@" ;;
esac
