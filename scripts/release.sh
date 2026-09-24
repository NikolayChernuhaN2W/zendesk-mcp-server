#!/usr/bin/env bash
# Build the Claude Desktop extension (.mcpb) into dist/, and prepare and tag
# releases. GitHub Actions publishes the release when a v* tag is pushed.
#
# Usage:
#   scripts/release.sh build [--allow-writes | --all]
#   scripts/release.sh prepare <version>
#   scripts/release.sh tag [--yes]
#
#   build            (no flag) read-only mode on by default,
#                    --allow-writes off by default, --all both variants
#   prepare X.Y.Z    set the version in package.json, package-lock.json and
#                    manifest.json, for a PR (never commits)
#   tag              on an up-to-date main, tag HEAD as v<version> and push
#                    the tag, which starts the release workflow
#                    (--yes skips the confirmation)
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  sed -n '5,17s/^# \{0,1\}//p' "$0"
  exit "${1:-1}"
}

fail() {
  echo "release: $*" >&2
  exit 1
}

# Prints the version without a leading v, or fails with parseVersion's message
parse_version() {
  node --input-type=module -e "
    import { parseVersion } from './scripts/release-lib.mjs';
    try { console.log(parseVersion(process.argv[1])); }
    catch (error) { console.error('release: ' + error.message); process.exit(1); }
  " "$1"
}

json_version() {
  node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version)" "$1"
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

prepare() {
  local version
  version=$(parse_version "$1") || exit 1

  # Work out the new package.json and manifest.json before changing anything,
  # so a refusal leaves the tree untouched. npm version updates
  # package-lock.json but rewrites package.json with its own indentation, so
  # package.json is then put back with only its version line changed.
  # manifest.json is written as 2-space JSON, so rewriting it only changes the
  # version line; refuse rather than reformat it if that ever stops holding.
  # Global, so the EXIT trap can still see it
  staged=$(mktemp -d)
  trap 'rm -rf "$staged"' EXIT
  node -e "
    const fs = require('fs');
    const [staged, version] = process.argv.slice(1);
    const fail = message => { console.error('release: ' + message); process.exit(1); };

    const pkgText = fs.readFileSync('package.json', 'utf8');
    const old = JSON.parse(pkgText).version;
    const pkgUpdated = pkgText.replace('\"version\": ' + JSON.stringify(old), '\"version\": ' + JSON.stringify(version));
    if (JSON.parse(pkgUpdated).version !== version) fail('could not set the version in package.json; set it by hand');

    const manifestText = fs.readFileSync('manifest.json', 'utf8');
    const m = JSON.parse(manifestText);
    if (JSON.stringify(m, null, 2) + '\n' !== manifestText) {
      fail('manifest.json is not formatted as 2-space JSON; set its version by hand');
    }
    m.version = version;

    fs.writeFileSync(staged + '/package.json', pkgUpdated);
    fs.writeFileSync(staged + '/manifest.json', JSON.stringify(m, null, 2) + '\n');
  " "$staged" "$version" || exit 1

  npm version "$version" --no-git-tag-version --allow-same-version >/dev/null
  cp "$staged/package.json" package.json
  cp "$staged/manifest.json" manifest.json

  echo "Set the version to $version in package.json, package-lock.json and manifest.json."
  if ! node scripts/release.mjs --notes "$version" >/dev/null 2>&1; then
    echo
    echo "Reminder: add a \"## v$version\" section to RELEASE_NOTES.md, written for"
    echo "the people installing the extension. The release uses it as its notes."
  fi
  cat <<NEXT

Next steps:
  1. Commit these changes on a branch and open a pull request to main.
  2. Merge it once the test check passes.
  3. On an up-to-date main, run: scripts/release.sh tag
NEXT
}

# https://github.com/<owner>/<repo> for a GitHub origin, nothing otherwise
github_url() {
  local remote
  remote=$(git remote get-url origin 2>/dev/null) || return 0
  if [[ $remote =~ ^(https://github\.com/|git@github\.com:)([^/]+/[^/]+)$ ]]; then
    echo "https://github.com/${BASH_REMATCH[2]%.git}"
  fi
}

tag() {
  local yes=false
  case "${1:-}" in
    "") ;;
    --yes) yes=true ;;
    *) usage ;;
  esac

  local branch
  branch=$(git symbolic-ref --short -q HEAD || true)
  [ "$branch" = main ] || fail "tag runs on main, not ${branch:-a detached HEAD}. Merge the release PR, then: git switch main && git pull"
  local changes
  changes=$(git status --porcelain) || fail "couldn't read the working tree status"
  [ -z "$changes" ] || fail "the working tree has uncommitted changes; commit or stash them first"

  git fetch --quiet origin main --tags || fail "couldn't fetch origin"
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
    || fail "main isn't the same as origin/main. Run git pull; changes reach main only through pull requests."

  local version manifest_version
  version=$(json_version package.json)
  manifest_version=$(json_version manifest.json)
  [ "$version" = "$manifest_version" ] \
    || fail "package.json is $version but manifest.json is $manifest_version. Fix it with scripts/release.sh prepare $version in a PR."
  node scripts/release.mjs --notes "$version" >/dev/null || exit 1

  local name="v$version"
  ! git rev-parse -q --verify "refs/tags/$name" >/dev/null || fail "tag $name already exists locally"
  local remote_tag
  remote_tag=$(git ls-remote --tags origin "refs/tags/$name") || fail "couldn't reach origin to check for tag $name"
  [ -z "$remote_tag" ] || fail "tag $name already exists on origin"

  npm test >/dev/null 2>&1 || fail "npm test fails; run it to see why"

  local sha short subject
  sha=$(git rev-parse HEAD)
  short=$(git rev-parse --short HEAD)
  subject=$(git log -1 --format=%s)
  echo "Version: $version"
  echo "Commit:  $short $subject"

  if [ "$yes" = false ]; then
    [ -t 0 ] || fail "no terminal to confirm on; pass --yes to tag without asking"
    local answer=
    read -rp "Tag $short as $name and push it? [y/N] " answer || true
    [[ $answer =~ ^[Yy]$ ]] || fail "not tagged"
  fi

  git tag -a "$name" -m "$name" -m "Released $(date -u +%F) from $sha"
  if ! git push origin "$name"; then
    git tag -d "$name" >/dev/null
    fail "push failed; the local tag was removed, so you can run tag again"
  fi

  local url
  url=$(github_url)
  [ -z "$url" ] || echo "GitHub Actions is now building the release: $url/actions"
}

command="${1:-}"
[ $# -eq 0 ] || shift
case "$command" in
  build) [ $# -le 1 ] || usage; build "$@" ;;
  prepare) [ $# -eq 1 ] || usage; prepare "$1" ;;
  tag) [ $# -le 1 ] || usage; tag "$@" ;;
  -h|--help) usage 0 ;;
  *) usage ;;
esac
