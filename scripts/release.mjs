#!/usr/bin/env node
// Build the Claude Desktop extension (.mcpb) and publish it as a release
// asset on the Forgejo repo that `origin` points at.
//
// Usage:
//   npm run release -- [--allow-writes] [--build-only]
//
//   --allow-writes  Ship with read-only mode off by default, so Claude can
//                   create, update and delete. Users can still turn it back
//                   on in the extension settings.
//   --build-only    Only build dist/*.mcpb, don't publish.
//
// Publishing needs FORGEJO_TOKEN: a Forgejo access token with the
// write:repository scope. FORGEJO_URL (https://host) and FORGEJO_REPO
// (owner/name) override the values derived from the origin remote.
//
// The version comes from package.json and the release is tagged v<version>.
// The release description is the "## v<version>" section of RELEASE_NOTES.md,
// written for the people installing the extension. Running again for the same
// version adds the other variant to the existing release.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const flags = process.argv.slice(2);
const usage = 'Usage: npm run release -- [--allow-writes] [--build-only]';

for (const flag of flags) {
  if (flag === '--help' || flag === '-h') {
    console.log(usage);
    process.exit(0);
  }
  if (flag !== '--allow-writes' && flag !== '--build-only') {
    fail(`Unknown argument: ${flag}\n${usage}`);
  }
}
const allowWrites = flags.includes('--allow-writes');
const buildOnly = flags.includes('--build-only');

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32',
    ...options
  }).trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function build() {
  const pkg = readJson(join(root, 'package.json'));
  const manifest = readJson(join(root, 'manifest.json'));

  // package.json is the source of truth for the version
  manifest.version = pkg.version;
  if (allowWrites) manifest.user_config.read_only.default = false;

  const suffix = allowWrites ? '-writes' : '';
  const fileName = `${manifest.name}-${pkg.version}${suffix}.mcpb`;
  const output = join(root, 'dist', fileName);

  // Stage only what the extension needs, with production dependencies only
  const stage = mkdtempSync(join(tmpdir(), 'mcpb-stage-'));
  try {
    cpSync(join(root, 'src'), join(stage, 'src'), { recursive: true });
    cpSync(join(root, 'package.json'), join(stage, 'package.json'));
    cpSync(join(root, 'package-lock.json'), join(stage, 'package-lock.json'));
    writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

    console.log('Installing production dependencies...');
    run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: stage });

    mkdirSync(join(root, 'dist'), { recursive: true });
    rmSync(output, { force: true });
    console.log(`Packing ${fileName} (read-only by default: ${!allowWrites})...`);
    run('npx', ['--no-install', 'mcpb', 'pack', stage, output]);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }

  return { version: pkg.version, fileName, output };
}

function resolveRepo() {
  const remote = run('git', ['remote', 'get-url', 'origin']);
  // ssh://git@host:2222/owner/repo.git, git@host:owner/repo.git, https://host/owner/repo.git
  const match = remote.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/)
    || remote.match(/^(?:ssh:\/\/)?(?:[^@/]+@)?([^:/]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/);

  const baseUrl = process.env.FORGEJO_URL || (match && `https://${match[1]}`);
  const repo = process.env.FORGEJO_REPO || (match && match[2]);
  if (!baseUrl || !repo) {
    fail(`Can't work out the repo from origin (${remote}). Set FORGEJO_URL and FORGEJO_REPO.`);
  }
  return { api: `${baseUrl.replace(/\/$/, '')}/api/v1/repos/${repo}`, repo };
}

async function api(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `token ${token}`, Accept: 'application/json', ...options.headers }
  });
  if (response.status === 404 && options.allow404) return null;
  if (!response.ok) {
    fail(`${options.method || 'GET'} ${url} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

// The user-facing notes for this version: its "## v<version>" section of
// RELEASE_NOTES.md, without the heading (the release title shows the version)
function releaseNotes(version) {
  const notes = readFileSync(join(root, 'RELEASE_NOTES.md'), 'utf8');
  const heading = `## v${version}`;
  const lines = notes.split('\n');
  const start = lines.findIndex(line => line.trim() === heading);
  if (start === -1) fail(`RELEASE_NOTES.md has no "${heading}" section. Write the notes for this release first.`);

  const rest = lines.slice(start + 1);
  const next = rest.findIndex(line => /^## /.test(line));
  const body = (next === -1 ? rest : rest.slice(0, next)).join('\n').trim();
  if (!body) fail(`The "${heading}" section of RELEASE_NOTES.md is empty.`);
  return body;
}

async function publish({ version, fileName, output }, notes) {
  const token = process.env.FORGEJO_TOKEN;
  if (!token) fail('Set FORGEJO_TOKEN to publish, or pass --build-only.');

  if (run('git', ['status', '--porcelain'])) {
    fail('Working tree has uncommitted changes; commit them so the release matches a commit.');
  }
  const sha = run('git', ['rev-parse', 'HEAD']);
  const tag = `v${version}`;
  const { api: repoApi, repo } = resolveRepo();

  let release = await api(`${repoApi}/releases/tags/${tag}`, token, { allow404: true });
  if (release) {
    console.log(`Adding to existing release ${tag}...`);
    if (release.assets.some(asset => asset.name === fileName)) {
      fail(`Release ${tag} already has ${fileName}. Bump the version in package.json or delete the asset.`);
    }
  } else {
    console.log(`Creating release ${tag} on ${repo} at ${sha.slice(0, 7)}...`);
    release = await api(`${repoApi}/releases`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: tag, target_commitish: sha, name: tag, body: notes })
    });
  }

  const form = new FormData();
  form.append('attachment', new Blob([readFileSync(output)]), fileName);
  await api(`${repoApi}/releases/${release.id}/assets?name=${encodeURIComponent(fileName)}`, token, {
    method: 'POST',
    body: form
  });

  console.log(`Published ${fileName}: ${release.html_url}`);
}

// Check the notes before spending time on a build
const notes = buildOnly ? null : releaseNotes(readJson(join(root, 'package.json')).version);
const artifact = build();
console.log(`Built ${artifact.output}`);
if (!buildOnly) await publish(artifact, notes);
