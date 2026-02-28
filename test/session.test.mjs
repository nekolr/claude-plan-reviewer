import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  SESSION_PATH,
  getReviewCount,
  incrementReviewCount,
  cleanStaleSessions,
} from '../src/session.mjs';

describe('session', () => {
  let tempDir;
  let tempSessionPath;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-test-'));
    tempSessionPath = join(tempDir, 'sessions.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('SESSION_PATH is in the OS temp directory', () => {
    assert.equal(SESSION_PATH, join(tmpdir(), 'claude-plan-reviewer-sessions.json'));
  });

  it('getReviewCount returns 0 for unknown session', () => {
    const count = getReviewCount('nonexistent-session', tempSessionPath);
    assert.equal(count, 0);
  });

  it('getReviewCount returns 0 when file does not exist', () => {
    const noFile = join(tempDir, 'no-such-file.json');
    const count = getReviewCount('any-session', noFile);
    assert.equal(count, 0);
  });

  it('incrementReviewCount creates file and returns 1 on first call', () => {
    const count = incrementReviewCount('session-1', tempSessionPath);
    assert.equal(count, 1);
    assert.ok(existsSync(tempSessionPath), 'session file should exist');
  });

  it('incrementReviewCount increments and returns correct count', () => {
    incrementReviewCount('session-1', tempSessionPath);
    const count2 = incrementReviewCount('session-1', tempSessionPath);
    assert.equal(count2, 2);

    const count3 = incrementReviewCount('session-1', tempSessionPath);
    assert.equal(count3, 3);
  });

  it('incrementReviewCount preserves other sessions', () => {
    incrementReviewCount('session-a', tempSessionPath);
    incrementReviewCount('session-b', tempSessionPath);
    incrementReviewCount('session-a', tempSessionPath);

    assert.equal(getReviewCount('session-a', tempSessionPath), 2);
    assert.equal(getReviewCount('session-b', tempSessionPath), 1);
  });

  it('cleanStaleSessions removes entries older than 24 hours', () => {
    const now = Date.now();
    const staleTime = now - 25 * 60 * 60 * 1000; // 25 hours ago

    // Manually write a session file with a stale entry
    const data = {
      'stale-session': { count: 3, lastReview: staleTime },
      'fresh-session': { count: 1, lastReview: now },
    };
    writeFileSync(tempSessionPath, JSON.stringify(data));

    cleanStaleSessions(tempSessionPath);

    const result = JSON.parse(readFileSync(tempSessionPath, 'utf-8'));
    assert.equal(result['stale-session'], undefined);
    assert.equal(result['fresh-session'].count, 1);
  });

  it('cleanStaleSessions keeps recent entries', () => {
    const now = Date.now();
    const recentTime = now - 12 * 60 * 60 * 1000; // 12 hours ago

    const data = {
      'recent-1': { count: 2, lastReview: recentTime },
      'recent-2': { count: 1, lastReview: now },
    };
    writeFileSync(tempSessionPath, JSON.stringify(data));

    cleanStaleSessions(tempSessionPath);

    const result = JSON.parse(readFileSync(tempSessionPath, 'utf-8'));
    assert.equal(result['recent-1'].count, 2);
    assert.equal(result['recent-2'].count, 1);
  });

  it('atomic write: file is written correctly after increment', () => {
    incrementReviewCount('atomic-test', tempSessionPath);

    const raw = readFileSync(tempSessionPath, 'utf-8');
    const data = JSON.parse(raw);

    assert.equal(data['atomic-test'].count, 1);
    assert.equal(typeof data['atomic-test'].lastReview, 'number');
    assert.ok(
      data['atomic-test'].lastReview <= Date.now(),
      'lastReview should be a timestamp not in the future',
    );
    assert.ok(
      data['atomic-test'].lastReview > Date.now() - 5000,
      'lastReview should be recent (within 5 seconds)',
    );
  });
});
