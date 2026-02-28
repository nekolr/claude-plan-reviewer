/**
 * Test module for hook.mjs
 *
 * Coverage:
 * - processHook is an exported async function
 * - Exits 0 when permission_mode is not "plan"
 * - Exits 0 when permission_mode is missing
 * - Calls cleanStaleSessions on every invocation with plan mode
 * - Exits 0 when review count >= maxReviews
 * - Exits 0 when no plan file found (findLatestPlan returns null)
 * - Calls buildPrompt with plan content and config prompt
 * - Calls getAdapter with config.adapter name
 * - Calls adapter.review with built prompt and adapter options
 * - Increments review count after successful review
 * - Writes review result to stderr
 * - Exits 2 after successful review (blocks Claude's stop)
 * - Exits 0 on adapter error (does not block Claude)
 * - Writes error message to stderr on adapter error
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { processHook } from '../src/hook.mjs';

/**
 * Creates a deps object with sensible defaults and optional overrides.
 * Also exposes stderrChunks and exitCalls arrays for assertions.
 */
function createDeps(overrides = {}) {
  const stderrChunks = [];
  const exitCalls = [];
  return {
    loadConfig: () => ({
      adapter: 'codex',
      maxReviews: 2,
      prompt: '',
      codex: { model: '', sandbox: 'read-only' },
    }),
    getReviewCount: () => 0,
    incrementReviewCount: () => 1,
    cleanStaleSessions: () => {},
    findLatestPlan: () => ({ path: '/tmp/plan.md', content: '# Plan\nDo stuff' }),
    buildPrompt: (content, custom) => `Review: ${content}`,
    getAdapter: () => ({ review: async () => 'LGTM' }),
    stderr: { write: (data) => stderrChunks.push(data) },
    exit: (code) => exitCalls.push(code),
    stderrChunks,
    exitCalls,
    ...overrides,
  };
}

describe('processHook', () => {
  it('is an exported async function', () => {
    assert.equal(typeof processHook, 'function');
    // Async functions have AsyncFunction constructor
    const AsyncFunction = (async () => {}).constructor;
    assert.ok(
      processHook instanceof AsyncFunction,
      'processHook should be an async function',
    );
  });

  it('exits 0 when permission_mode is not "plan"', async () => {
    const deps = createDeps();
    await processHook({ session_id: 'abc-123', permission_mode: 'auto' }, deps);

    assert.deepEqual(deps.exitCalls, [0]);
  });

  it('exits 0 when permission_mode is missing', async () => {
    const deps = createDeps();
    await processHook({ session_id: 'abc-123' }, deps);

    assert.deepEqual(deps.exitCalls, [0]);
  });

  it('calls cleanStaleSessions on every invocation with plan mode', async () => {
    let cleanCalled = false;
    const deps = createDeps({
      cleanStaleSessions: () => { cleanCalled = true; },
    });

    await processHook({ session_id: 'abc-123', permission_mode: 'plan' }, deps);

    assert.ok(cleanCalled, 'cleanStaleSessions should have been called');
  });

  it('exits 0 when review count >= maxReviews', async () => {
    const deps = createDeps({
      getReviewCount: () => 2, // equals maxReviews of 2
    });

    await processHook({ session_id: 'abc-123', permission_mode: 'plan' }, deps);

    assert.deepEqual(deps.exitCalls, [0]);
  });

  it('exits 0 when no plan file found (findLatestPlan returns null)', async () => {
    const deps = createDeps({
      findLatestPlan: () => null,
    });

    await processHook({ session_id: 'abc-123', permission_mode: 'plan' }, deps);

    assert.deepEqual(deps.exitCalls, [0]);
  });

  it('calls buildPrompt with plan content and config prompt', async () => {
    let buildPromptArgs = null;
    const deps = createDeps({
      buildPrompt: (content, custom) => {
        buildPromptArgs = { content, custom };
        return `Review: ${content}`;
      },
    });

    await processHook({ session_id: 'abc-123', permission_mode: 'plan' }, deps);

    assert.notEqual(buildPromptArgs, null, 'buildPrompt should have been called');
    assert.equal(buildPromptArgs.content, '# Plan\nDo stuff');
    assert.equal(buildPromptArgs.custom, '');
  });

  it('calls getAdapter with config.adapter name', async () => {
    let getAdapterArg = null;
    const deps = createDeps({
      getAdapter: (name) => {
        getAdapterArg = name;
        return { review: async () => 'LGTM' };
      },
    });

    await processHook({ session_id: 'abc-123', permission_mode: 'plan' }, deps);

    assert.equal(getAdapterArg, 'codex');
  });

  it('calls adapter.review with built prompt and adapter options', async () => {
    let reviewArgs = null;
    const deps = createDeps({
      getAdapter: () => ({
        review: async (prompt, options) => {
          reviewArgs = { prompt, options };
          return 'LGTM';
        },
      }),
    });

    await processHook({ session_id: 'abc-123', permission_mode: 'plan' }, deps);

    assert.notEqual(reviewArgs, null, 'adapter.review should have been called');
    assert.equal(reviewArgs.prompt, 'Review: # Plan\nDo stuff');
    assert.deepEqual(reviewArgs.options, { model: '', sandbox: 'read-only' });
  });

  it('increments review count after successful review', async () => {
    let incrementedSessionId = null;
    const deps = createDeps({
      incrementReviewCount: (sessionId) => { incrementedSessionId = sessionId; return 1; },
    });

    await processHook({ session_id: 'abc-123', permission_mode: 'plan' }, deps);

    assert.equal(incrementedSessionId, 'abc-123');
  });

  it('writes review result to stderr', async () => {
    const deps = createDeps();

    await processHook({ session_id: 'abc-123', permission_mode: 'plan' }, deps);

    assert.ok(
      deps.stderrChunks.includes('LGTM'),
      `stderr should contain "LGTM", got: ${JSON.stringify(deps.stderrChunks)}`,
    );
  });

  it('exits 2 after successful review (blocks Claude stop)', async () => {
    const deps = createDeps();

    await processHook({ session_id: 'abc-123', permission_mode: 'plan' }, deps);

    assert.deepEqual(deps.exitCalls, [2]);
  });

  it('exits 0 on adapter error (does not block Claude)', async () => {
    const deps = createDeps({
      getAdapter: () => ({
        review: async () => { throw new Error('API timeout'); },
      }),
    });

    await processHook({ session_id: 'abc-123', permission_mode: 'plan' }, deps);

    assert.deepEqual(deps.exitCalls, [0]);
  });

  it('writes error message to stderr on adapter error', async () => {
    const deps = createDeps({
      getAdapter: () => ({
        review: async () => { throw new Error('API timeout'); },
      }),
    });

    await processHook({ session_id: 'abc-123', permission_mode: 'plan' }, deps);

    const stderrOutput = deps.stderrChunks.join('');
    assert.ok(
      stderrOutput.includes('API timeout'),
      `stderr should contain the error message, got: ${stderrOutput}`,
    );
  });
});
