import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  utimesSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { PLANS_DIR, findLatestPlan } from '../src/plan.mjs';

describe('plan', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'plan-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('PLANS_DIR ends with .claude/plans', () => {
    assert.ok(
      PLANS_DIR.endsWith(join('.claude', 'plans')),
      `Expected PLANS_DIR to end with .claude/plans but got: ${PLANS_DIR}`,
    );
  });

  it('findLatestPlan returns null when directory does not exist', () => {
    const nonExistent = join(tempDir, 'no-such-dir');
    const result = findLatestPlan(nonExistent);
    assert.equal(result, null);
  });

  it('findLatestPlan returns null when directory is empty', () => {
    const emptyDir = join(tempDir, 'empty');
    mkdirSync(emptyDir);
    const result = findLatestPlan(emptyDir);
    assert.equal(result, null);
  });

  it('findLatestPlan returns null when no .md files exist (only .txt files)', () => {
    writeFileSync(join(tempDir, 'notes.txt'), 'some text');
    writeFileSync(join(tempDir, 'readme.txt'), 'more text');
    const result = findLatestPlan(tempDir);
    assert.equal(result, null);
  });

  it('findLatestPlan returns the most recently modified .md file', () => {
    const now = new Date();
    const older = new Date(now.getTime() - 60_000); // 1 minute ago
    const newest = new Date(now.getTime() - 10_000); // 10 seconds ago

    const oldFile = join(tempDir, 'old-plan.md');
    const newFile = join(tempDir, 'new-plan.md');

    writeFileSync(oldFile, 'old plan content');
    utimesSync(oldFile, older, older);

    writeFileSync(newFile, 'new plan content');
    utimesSync(newFile, newest, newest);

    const result = findLatestPlan(tempDir);
    assert.notEqual(result, null);
    assert.equal(result.path, newFile);
  });

  it('findLatestPlan returns { path, content } with correct content', () => {
    const content = '# My Plan\n\nStep 1: Do something\nStep 2: Do more';
    const planFile = join(tempDir, 'plan.md');
    writeFileSync(planFile, content);

    const result = findLatestPlan(tempDir);
    assert.notEqual(result, null);
    assert.equal(result.path, planFile);
    assert.equal(result.content, content);
  });

  it('findLatestPlan returns null when all files are older than maxAge', () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const planFile = join(tempDir, 'stale-plan.md');
    writeFileSync(planFile, 'stale plan');
    utimesSync(planFile, tenMinutesAgo, tenMinutesAgo);

    // Default maxAge is 5 minutes, so a 10-minute-old file should be excluded
    const result = findLatestPlan(tempDir);
    assert.equal(result, null);
  });

  it('findLatestPlan uses custom maxAgeMs parameter', () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

    const planFile = join(tempDir, 'recent-plan.md');
    writeFileSync(planFile, 'recent plan content');
    utimesSync(planFile, twoMinutesAgo, twoMinutesAgo);

    // With 1 minute maxAge, a 2-minute-old file should be excluded
    const tooShort = findLatestPlan(tempDir, 60_000);
    assert.equal(tooShort, null);

    // With 5 minute maxAge, a 2-minute-old file should be included
    const longEnough = findLatestPlan(tempDir, 5 * 60 * 1000);
    assert.notEqual(longEnough, null);
    assert.equal(longEnough.path, planFile);
    assert.equal(longEnough.content, 'recent plan content');
  });

  it('findLatestPlan ignores non-.md files even if they are newer', () => {
    const now = new Date();
    const older = new Date(now.getTime() - 30_000); // 30 seconds ago
    const newest = new Date(now.getTime() - 5_000); // 5 seconds ago

    const mdFile = join(tempDir, 'plan.md');
    const txtFile = join(tempDir, 'notes.txt');
    const jsonFile = join(tempDir, 'data.json');

    writeFileSync(mdFile, 'the plan');
    utimesSync(mdFile, older, older);

    writeFileSync(txtFile, 'newer text file');
    utimesSync(txtFile, newest, newest);

    writeFileSync(jsonFile, '{"newer": true}');
    utimesSync(jsonFile, newest, newest);

    const result = findLatestPlan(tempDir);
    assert.notEqual(result, null);
    assert.equal(result.path, mdFile);
    assert.equal(result.content, 'the plan');
  });
});
