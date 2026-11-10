#!/usr/bin/env node
/**
 * Release helper: bumps the version everywhere, turns "## [Unreleased]" in CHANGELOG.md
 * into a version section and (optionally) creates the release commit and tag.
 *
 *   node scripts/release.mjs patch|minor|major|X.Y.Z [--title "Titel"] [--commit] [--notes-out FILE]
 *   node scripts/release.mjs --notes X.Y.Z [--notes-out FILE]    # print the notes of a released version
 *   node scripts/release.mjs --check                              # versions consistent?
 *
 * If [Unreleased] is empty, it is filled from the commit subjects since the last tag.
 */
import { readFileSync, writeFileSync, appendFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');
const VERSION_FILES = ['package.json', 'package-lock.json', 'frontend/package.json', 'frontend/package-lock.json'];
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const readJson = f => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const writeJson = (f, data) => writeFileSync(join(ROOT, f), JSON.stringify(data, null, 2) + '\n');
const fail = msg => {
  console.error(`❌ ${msg}`);
  process.exit(1);
};

export function nextVersion(current, bump) {
  if (SEMVER.test(bump)) return bump;
  const m = SEMVER.exec(current);
  if (!m) throw new Error(`Aktuelle Version "${current}" ist kein X.Y.Z`);
  const [maj, min, pat] = m.slice(1).map(Number);
  if (bump === 'major') return `${maj + 1}.0.0`;
  if (bump === 'minor') return `${maj}.${min + 1}.0`;
  if (bump === 'patch') return `${maj}.${min}.${pat + 1}`;
  throw new Error(`Unbekannte Stufe "${bump}" (patch, minor, major oder X.Y.Z)`);
}

const isNewer = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
};

/** Split the changelog into the text before [Unreleased], its body and the rest. */
export function splitUnreleased(text) {
  const start = text.indexOf('## [Unreleased]');
  if (start < 0) throw new Error('CHANGELOG.md hat keinen Abschnitt "## [Unreleased]"');
  const bodyStart = text.indexOf('\n', start) + 1;
  const next = text.indexOf('\n## [', bodyStart);
  const bodyEnd = next < 0 ? text.length : next + 1;
  return { head: text.slice(0, start), body: text.slice(bodyStart, bodyEnd).trim(), tail: text.slice(bodyEnd) };
}

/** Notes of one released version from the changelog (without its heading). */
export function notesFor(text, version) {
  const heading = text.indexOf(`## [${version}]`);
  if (heading < 0) return null;
  const bodyStart = text.indexOf('\n', heading) + 1;
  const next = text.indexOf('\n## [', bodyStart);
  return text.slice(bodyStart, next < 0 ? text.length : next).trim();
}

export function insertRelease(text, version, date, title, generatedBody) {
  const { head, body, tail } = splitUnreleased(text);
  const notes = body || generatedBody;
  if (!notes) throw new Error('Keine Änderungen seit dem letzten Release – nichts zu veröffentlichen');
  const heading = `## [${version}] - ${date}${title ? ` – ${title}` : ''}`;
  return { text: `${head}## [Unreleased]\n\n${heading}\n\n${notes}\n\n${tail}`.replace(/\n{3,}/g, '\n\n'), notes };
}

function commitsSinceLastTag() {
  let range = 'HEAD';
  try {
    range = `${git('describe', '--tags', '--abbrev=0', '--match', 'v*')}..HEAD`;
  } catch {
    /* no tag yet: all commits */
  }
  return git('log', '--no-merges', '--format=%s', range)
    .split('\n')
    .filter(s => s && !/^release:/i.test(s))
    .map(s => `- ${s}`)
    .join('\n');
}

function checkVersions() {
  const versions = Object.fromEntries(
    VERSION_FILES.map(f => {
      const j = readJson(f);
      return [f, f.endsWith('lock.json') ? [j.version, j.packages?.['']?.version] : [j.version]];
    })
  );
  const all = new Set(Object.values(versions).flat());
  if (all.size !== 1) {
    fail(`Versionen passen nicht zusammen: ${JSON.stringify(versions)}`);
  }
  return [...all][0];
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function main(argv) {
  const opt = { commit: false, title: '', notesOut: '' };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--commit') opt.commit = true;
    else if (a === '--title') opt.title = argv[++i] ?? '';
    else if (a === '--notes-out') opt.notesOut = argv[++i] ?? '';
    else if (a === '--notes') opt.notes = argv[++i];
    else if (a === '--check') opt.check = true;
    else pos.push(a);
  }

  if (opt.check) {
    console.log(`✅ Version ${checkVersions()} in allen Dateien`);
    return;
  }

  if (opt.notes) {
    const notes = notesFor(readFileSync(CHANGELOG, 'utf8'), opt.notes.replace(/^v/, ''));
    if (notes === null) fail(`Version ${opt.notes} steht nicht in CHANGELOG.md`);
    if (opt.notesOut) writeFileSync(opt.notesOut, notes + '\n');
    else console.log(notes);
    return;
  }

  const bump = pos[0];
  if (!bump) fail('Stufe fehlt: patch, minor, major oder X.Y.Z');
  if (opt.commit && git('status', '--porcelain')) fail('Arbeitsverzeichnis nicht sauber – erst committen');

  const current = checkVersions();
  let version;
  try {
    version = nextVersion(current, bump);
  } catch (err) {
    fail(err.message);
  }
  if (!isNewer(version, current)) fail(`${version} ist nicht neuer als ${current}`);
  if (git('tag', '--list', `v${version}`)) fail(`Tag v${version} existiert bereits`);

  const date = new Date().toISOString().slice(0, 10);
  let result;
  try {
    result = insertRelease(readFileSync(CHANGELOG, 'utf8'), version, date, opt.title.trim(), commitsSinceLastTag());
  } catch (err) {
    fail(err.message);
  }
  writeFileSync(CHANGELOG, result.text);

  for (const f of VERSION_FILES) {
    const j = readJson(f);
    j.version = version;
    if (f.endsWith('lock.json') && j.packages?.['']) j.packages[''].version = version;
    writeJson(f, j);
  }
  if (opt.notesOut) writeFileSync(opt.notesOut, result.notes + '\n');

  if (opt.commit) {
    const subject = `release: v${version}${opt.title ? ` – ${opt.title.trim()}` : ''}`;
    git('add', 'CHANGELOG.md', ...VERSION_FILES);
    git('commit', '-q', '-m', subject);
    git('tag', '-a', `v${version}`, '-m', subject);
  }

  setOutput('version', version);
  console.log(`✅ ${current} → ${version}${opt.commit ? ` (Commit und Tag v${version} angelegt)` : ''}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
