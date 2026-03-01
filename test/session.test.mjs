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
  saveOriginalPlan,
  getOriginalPlan,
  resetReviewCount,
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

// ============================================================
// incrementReviewCount spread fix
// ============================================================

describe('incrementReviewCount preserves extra fields', () => {
  let tempDir;
  let tempSessionPath;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-spread-test-'));
    tempSessionPath = join(tempDir, 'sessions.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should preserve originalPlan field after increment', () => {
    // Arrange: manually write a session file with an extra field
    const data = {
      'sess-1': { count: 1, lastReview: 12345, originalPlan: 'my plan' },
    };
    writeFileSync(tempSessionPath, JSON.stringify(data));

    // Act: increment the review count
    const newCount = incrementReviewCount('sess-1', tempSessionPath);

    // Assert: count is incremented
    assert.equal(newCount, 2);

    // Assert: originalPlan field is still present (not lost by overwrite)
    const result = JSON.parse(readFileSync(tempSessionPath, 'utf-8'));
    assert.equal(result['sess-1'].count, 2);
    assert.equal(
      result['sess-1'].originalPlan,
      'my plan',
      'originalPlan must be preserved after incrementReviewCount',
    );
  });
});

// ============================================================
// saveOriginalPlan
// ============================================================

describe('saveOriginalPlan', () => {
  let tempDir;
  let tempSessionPath;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-save-plan-test-'));
    tempSessionPath = join(tempDir, 'sessions.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should save plan content for a session', () => {
    // Arrange
    const sessionId = 'plan-sess-1';
    const planContent = '## My Plan\n- Step 1\n- Step 2';

    // Act
    saveOriginalPlan(sessionId, planContent, tempSessionPath);

    // Assert
    const result = JSON.parse(readFileSync(tempSessionPath, 'utf-8'));
    assert.equal(result[sessionId].originalPlan, planContent);
  });

  it('should NOT overwrite an existing originalPlan', () => {
    // Arrange
    const sessionId = 'plan-sess-2';
    const firstPlan = 'First version of the plan';
    const secondPlan = 'Second version of the plan';

    // Act: save twice with different content
    saveOriginalPlan(sessionId, firstPlan, tempSessionPath);
    saveOriginalPlan(sessionId, secondPlan, tempSessionPath);

    // Assert: the first plan content is kept
    const result = JSON.parse(readFileSync(tempSessionPath, 'utf-8'));
    assert.equal(
      result[sessionId].originalPlan,
      firstPlan,
      'originalPlan must not be overwritten on second call',
    );
  });

  it('should create session file when it does not exist yet', () => {
    // Arrange: ensure file does not exist
    const noFile = join(tempDir, 'nonexistent-sessions.json');
    assert.equal(existsSync(noFile), false, 'file must not exist before test');

    // Act
    saveOriginalPlan('new-sess', 'brand new plan', noFile);

    // Assert
    assert.ok(existsSync(noFile), 'session file should be created');
    const result = JSON.parse(readFileSync(noFile, 'utf-8'));
    assert.equal(result['new-sess'].originalPlan, 'brand new plan');
  });

  it('incrementReviewCount returns 1 after saveOriginalPlan on fresh session', () => {
    saveOriginalPlan('sess', 'plan', tempSessionPath);
    const count = incrementReviewCount('sess', tempSessionPath);
    assert.equal(count, 1);
  });
});

// ============================================================
// getOriginalPlan
// ============================================================

describe('getOriginalPlan', () => {
  let tempDir;
  let tempSessionPath;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-get-plan-test-'));
    tempSessionPath = join(tempDir, 'sessions.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return null when session does not exist', () => {
    // Act: query a session that was never created (file doesn't exist)
    const result = getOriginalPlan('nonexistent-session', tempSessionPath);

    // Assert
    assert.equal(result, null);
  });

  it('should return null when session exists but has no originalPlan', () => {
    // Arrange: session exists with count/lastReview but no originalPlan
    const data = {
      'sess-no-plan': { count: 3, lastReview: Date.now() },
    };
    writeFileSync(tempSessionPath, JSON.stringify(data));

    // Act
    const result = getOriginalPlan('sess-no-plan', tempSessionPath);

    // Assert
    assert.equal(result, null);
  });

  it('should return the saved plan content', () => {
    // Arrange: session has originalPlan
    const planContent = '## Detailed Plan\n1. Do this\n2. Do that';
    const data = {
      'sess-with-plan': {
        count: 1,
        lastReview: Date.now(),
        originalPlan: planContent,
      },
    };
    writeFileSync(tempSessionPath, JSON.stringify(data));

    // Act
    const result = getOriginalPlan('sess-with-plan', tempSessionPath);

    // Assert
    assert.equal(result, planContent);
  });
});

// ============================================================
// resetReviewCount
// ============================================================

describe('resetReviewCount', () => {
  let tempDir;
  let tempSessionPath;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-reset-test-'));
    tempSessionPath = join(tempDir, 'sessions.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('resets count to 0 for existing session', () => {
    // Arrange: create a session with count:3
    const data = {
      'sess-1': { count: 3, lastReview: Date.now() },
    };
    writeFileSync(tempSessionPath, JSON.stringify(data));

    // Act
    resetReviewCount('sess-1', tempSessionPath);

    // Assert
    const result = JSON.parse(readFileSync(tempSessionPath, 'utf-8'));
    assert.equal(result['sess-1'].count, 0);
  });

  it('clears originalPlan', () => {
    // Arrange: create a session with originalPlan
    const data = {
      'sess-1': { count: 2, lastReview: Date.now(), originalPlan: 'some plan' },
    };
    writeFileSync(tempSessionPath, JSON.stringify(data));

    // Act
    resetReviewCount('sess-1', tempSessionPath);

    // Assert: originalPlan should not be in persisted JSON
    const result = JSON.parse(readFileSync(tempSessionPath, 'utf-8'));
    assert.equal(
      result['sess-1'].originalPlan,
      undefined,
      'originalPlan should be cleared (undefined) after resetReviewCount',
    );
    assert.ok(
      !('originalPlan' in result['sess-1']),
      'originalPlan key should not exist in persisted JSON',
    );
  });

  it('preserves lastReview and other fields', () => {
    // Arrange: create a session with lastReview, extra fields
    const data = {
      'sess-1': { count: 5, lastReview: 12345, customField: 'preserved' },
    };
    writeFileSync(tempSessionPath, JSON.stringify(data));

    // Act
    resetReviewCount('sess-1', tempSessionPath);

    // Assert: lastReview and customField should be preserved
    const result = JSON.parse(readFileSync(tempSessionPath, 'utf-8'));
    assert.equal(result['sess-1'].lastReview, 12345);
    assert.equal(result['sess-1'].customField, 'preserved');
    assert.equal(result['sess-1'].count, 0);
  });

  it('is a no-op when session does not exist', () => {
    // Arrange: create a session file with a different session
    const data = {
      'other-sess': { count: 1, lastReview: Date.now() },
    };
    writeFileSync(tempSessionPath, JSON.stringify(data));
    const before = readFileSync(tempSessionPath, 'utf-8');

    // Act: reset a non-existent session
    resetReviewCount('nonexistent-session', tempSessionPath);

    // Assert: file content should be unchanged
    const after = readFileSync(tempSessionPath, 'utf-8');
    assert.deepEqual(JSON.parse(after), JSON.parse(before));
  });

  it('preserves other sessions', () => {
    // Arrange: create two sessions
    const data = {
      'sess-a': { count: 3, lastReview: 111, originalPlan: 'plan A' },
      'sess-b': { count: 7, lastReview: 222, originalPlan: 'plan B' },
    };
    writeFileSync(tempSessionPath, JSON.stringify(data));

    // Act: reset only sess-a
    resetReviewCount('sess-a', tempSessionPath);

    // Assert: sess-b should be completely untouched
    const result = JSON.parse(readFileSync(tempSessionPath, 'utf-8'));
    assert.equal(result['sess-b'].count, 7);
    assert.equal(result['sess-b'].lastReview, 222);
    assert.equal(result['sess-b'].originalPlan, 'plan B');

    // sess-a should be reset
    assert.equal(result['sess-a'].count, 0);
  });
});
