#!/usr/bin/env node
// Build the Claude Desktop extension (.mcpb) into dist/.
//
// Usage:
//   node scripts/release.mjs [--allow-writes] [--version X.Y.Z]
//   node scripts/release.mjs --notes X.Y.Z
//
//   --allow-writes     Ship with read-only mode off by default, so Claude can
//                      create, update and delete. Users can still turn it back
//                      on in the extension settings.
//   --version X.Y.Z    Version the manifest and file name with this instead of
//                      package.json's version. The release workflow passes the
//                      version from the tag.
//   --notes X.Y.Z      Print the "## vX.Y.Z" section of RELEASE_NOTES.md and
//                      exit, without building.
//
// Releases are published by GitHub Actions: `scripts/release.sh prepare`
// sets the version for a PR, and after it merges `scripts/release.sh tag`
// pushes a v<version> tag. The release workflow then builds both variants
// and creates the GitHub Release with that version's notes.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVersion, releaseNotes } from './release-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node scripts/release.mjs [--allow-writes] [--version X.Y.Z]\n'
  + '       node scripts/release.mjs --notes X.Y.Z';

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

function parseArgs(args) {
  const options = { allowWrites: false, version: null, notes: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.log(usage);
      process.exit(0);
    } else if (arg === '--allow-writes') {
      options.allowWrites = true;
    } else if ((arg === '--version' || arg === '--notes') && i + 1 < args.length) {
      options[arg.slice(2)] = args[++i];
    } else {
      fail(`Unknown argument: ${arg}\n${usage}`);
    }
  }
  return options;
}

function build({ allowWrites, version }) {
  const pkg = readJson(join(root, 'package.json'));
  const manifest = readJson(join(root, 'manifest.json'));

  // package.json is the source of truth for the version, unless one is given
  manifest.version = version || pkg.version;
  if (allowWrites) manifest.user_config.read_only.default = false;

  const suffix = allowWrites ? '-writes' : '';
  const fileName = `${manifest.name}-${manifest.version}${suffix}.mcpb`;
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

  return output;
}

const options = parseArgs(process.argv.slice(2));
try {
  if (options.notes !== null) {
    const notes = releaseNotes(readFileSync(join(root, 'RELEASE_NOTES.md'), 'utf8'), parseVersion(options.notes));
    process.stdout.write(notes + '\n');
    process.exit(0);
  }
  if (options.version !== null) options.version = parseVersion(options.version);
} catch (error) {
  fail(error.message);
}
console.log(`Built ${build(options)}`);
