import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { allowedPath, checkPatchText, applyPatch } from './control.mjs';

test('path boundary permits product edits and rejects runner, credentials and instructions', () => {
  for (const p of ['src/app/page.tsx', 'server/auth.mjs', 'edge/resp_test.py', 'README.md']) assert.equal(allowedPath(p), true, p);
  for (const p of ['../src/a', '/src/a', 'src/../a', '.github/workflows/a.yml', '.env', 'src/.env', 'src/AGENTS.md', 'CLAUDE.md', 'tools/dots-cloud/control.mjs', 'package.json', 'package-lock.json', 'server/data/db.json', 'edge/edge_config.json']) assert.equal(allowedPath(p), false, p);
});

test('rejects empty, binary, oversized and credential-bearing patches', () => {
  for (const p of ['', 'GIT binary patch\n', 'x'.repeat(1024 * 1024 + 1), '+-----BEGIN PRIVATE KEY-----', '+token = sk-' + 'x'.repeat(25)]) assert.throws(() => checkPatchText(p));
});

function fixture(t, path, content, mode) {
  const root = mkdtempSync(join(tmpdir(), 'dots-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test');
  writeFileSync(join(repo, 'README.md'), 'baseline\n');
  git('add', '.'); git('commit', '-qm', 'base');
  mkdirSync(join(repo, path, '..'), { recursive: true });
  writeFileSync(join(repo, path), content);
  git('add', '.');
  if (mode) {
    const blob = git('hash-object', '-w', '--stdin');
    git('update-index', '--cacheinfo', mode, blob.trim(), path);
  }
  const patch = join(root, 'changes.patch');
  writeFileSync(patch, git('diff', '--cached', '--binary'));
  git('reset', '--hard', 'HEAD'); git('clean', '-fd');
  return { repo, patch };
}

test('applies a legitimate new source file on a clean base', t => {
  const f = fixture(t, 'server/new.mjs', 'export const ready = true;\n');
  assert.deepEqual(applyPatch(f.repo, f.patch), ['server/new.mjs']);
});
test('rejects protected paths after parsing with git, including quoted spaces', t => {
  const f = fixture(t, '.github/workflows/new task.yml', 'name: unexpected\n');
  assert.throws(() => applyPatch(f.repo, f.patch), /Protected path/);
});
test('rejects symlinks', t => {
  const f = fixture(t, 'server/link', '', '120000');
  assert.throws(() => applyPatch(f.repo, f.patch), /Symlinks/);
});
test('refuses an incorrect base', t => {
  const f = fixture(t, 'README.md', 'new contents\n');
  writeFileSync(join(f.repo, 'README.md'), 'uncommitted work\n');
  assert.throws(() => applyPatch(f.repo, f.patch), /clean checkout/);
});
test('rejects renaming protected instructions into an otherwise allowed directory', t => {
  const f = fixture(t, 'docs/new.md', 'new\n');
  const git = (...args) => execFileSync('git', args, { cwd: f.repo, encoding: 'utf8' });
  writeFileSync(join(f.repo, 'AGENTS.md'), 'trusted instructions\n');
  git('add', '.'); git('commit', '-qm', 'instructions');
  mkdirSync(join(f.repo, 'docs'), { recursive: true });
  git('mv', 'AGENTS.md', 'docs/moved.md');
  writeFileSync(f.patch, git('diff', '--cached'));
  git('reset', '--hard', 'HEAD');
  assert.throws(() => applyPatch(f.repo, f.patch), /Protected path: AGENTS.md/);
});
test('accepts the reviewed hash and rejects replaced artifacts before applying', t => {
  const f = fixture(t, 'server/new.mjs', 'export const ready = true;\n');
  assert.throws(() => applyPatch(f.repo, f.patch, '0'.repeat(64)), /hash mismatch/);
  const hash = createHash('sha256').update(readFileSync(f.patch)).digest('hex');
  assert.deepEqual(applyPatch(f.repo, f.patch, hash), ['server/new.mjs']);
});
