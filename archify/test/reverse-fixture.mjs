// Shared fixture builder for reverse-engineering tests: a real Git repository
// with a real pinned revision, because evidence verification is defined against
// Git objects rather than the working tree.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

export function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

export function createRepository(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-reverse-'));
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'reverse@archify.test']);
  git(root, ['config', 'user.name', 'Archify Reverse Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['remote', 'add', 'origin', 'https://github.com/archify/reverse-fixture.git']);
  for (const [relativePath, content] of Object.entries(files)) write(root, relativePath, content);
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '-m', 'fixture']);
  return { root, revision: git(root, ['rev-parse', 'HEAD']) };
}

export function commitAll(root, message = 'update') {
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

export function removeRepository(root) {
  fs.rmSync(root, { recursive: true, force: true });
}
