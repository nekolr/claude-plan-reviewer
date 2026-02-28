/**
 * Test module for hook.mjs
 *
 * Coverage:
 * - processHook is an exported async function
 * - Calls cleanStaleSessions on every invocation
 * - Returns silently when review count >= maxReviews (allows ExitPlanMode)
 * - Returns silently when no plan file found (allows ExitPlanMode)
 * - Calls buildPrompt with plan content and config prompt
 * - Calls getAdapter with config.adapter name
 * - Calls adapter.review with built prompt and adapter options
 * - Increments review count after successful review
 * - Outputs hookSpecificOutput with deny decision to stdout on success
 * - Returns silently on adapter error (allows ExitPlanMode)
 * - Writes error message to stderr on adapter error
 * - Writes review header to stderr before calling adapter.review
 * - Writes review footer to stderr after review completes
 * - Passes onData callback to adapter.review as 3rd argument
 * - Streams review chunks to stderr via onData
 * - Does not write review header when maxReviews reached
 * - Does not write review header when no plan found
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { processHook } from '../src/hook.mjs';

const HOOK_INPUT = { session_id: 'abc-123', tool_name: 'ExitPlanMode', hook_event_name: 'PreToolUse' };

/**
 * Creates a deps object with sensible defaults and optional overrides.
 * Exposes stdoutChunks, stderrChunks for assertions.
 */
function createDeps(overrides = {}) {
  const stdoutChunks = [];
  const stderrChunks = [];
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
    getAdapter: () => ({ review: async (prompt, options, deps) => 'LGTM' }),
    stdout: { write: (data) => stdoutChunks.push(data) },
    stderr: { write: (data) => stderrChunks.push(data) },
    stdoutChunks,
    stderrChunks,
    ...overrides,
  };
}

describe('processHook', () => {
  it('is an exported async function', () => {
    assert.equal(typeof processHook, 'function');
    const AsyncFunction = (async () => {}).constructor;
    assert.ok(
      processHook instanceof AsyncFunction,
      'processHook should be an async function',
    );
  });

  it('calls cleanStaleSessions on every invocation', async () => {
    let cleanCalled = false;
    const deps = createDeps({
      cleanStaleSessions: () => { cleanCalled = true; },
    });

    await processHook(HOOK_INPUT, deps);

    assert.ok(cleanCalled, 'cleanStaleSessions should have been called');
  });

  it('produces no stdout when review count >= maxReviews', async () => {
    const deps = createDeps({
      getReviewCount: () => 2,
    });

    await processHook(HOOK_INPUT, deps);

    assert.deepEqual(deps.stdoutChunks, []);
  });

  it('produces no stdout when no plan file found', async () => {
    const deps = createDeps({
      findLatestPlan: () => null,
    });

    await processHook(HOOK_INPUT, deps);

    assert.deepEqual(deps.stdoutChunks, []);
  });

  it('calls buildPrompt with plan content and config prompt', async () => {
    let buildPromptArgs = null;
    const deps = createDeps({
      buildPrompt: (content, custom) => {
        buildPromptArgs = { content, custom };
        return `Review: ${content}`;
      },
    });

    await processHook(HOOK_INPUT, deps);

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

    await processHook(HOOK_INPUT, deps);

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

    await processHook(HOOK_INPUT, deps);

    assert.notEqual(reviewArgs, null, 'adapter.review should have been called');
    assert.equal(reviewArgs.prompt, 'Review: # Plan\nDo stuff');
    assert.deepEqual(reviewArgs.options, { model: '', sandbox: 'read-only' });
  });

  it('increments review count after successful review', async () => {
    let incrementedSessionId = null;
    const deps = createDeps({
      incrementReviewCount: (sessionId) => { incrementedSessionId = sessionId; return 1; },
    });

    await processHook(HOOK_INPUT, deps);

    assert.equal(incrementedSessionId, 'abc-123');
  });

  it('outputs hookSpecificOutput with deny decision to stdout on success', async () => {
    const deps = createDeps();

    await processHook(HOOK_INPUT, deps);

    const output = deps.stdoutChunks.join('');
    const parsed = JSON.parse(output.trim());
    const expectedReason =
      'ExitPlanMode was blocked by claude-plan-reviewer. Revise your plan based on the following review feedback, then call ExitPlanMode again.\n\nLGTM';
    assert.deepEqual(parsed, {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expectedReason,
      },
    });
  });

  it('permissionDecisionReason includes instruction prefix before review result', async () => {
    const reviewText = 'Please fix the error handling in step 3.';
    const deps = createDeps({
      getAdapter: () => ({ review: async () => reviewText }),
    });

    await processHook(HOOK_INPUT, deps);

    const output = deps.stdoutChunks.join('');
    const parsed = JSON.parse(output.trim());
    const reason = parsed.hookSpecificOutput.permissionDecisionReason;
    const prefix =
      'ExitPlanMode was blocked by claude-plan-reviewer. Revise your plan based on the following review feedback, then call ExitPlanMode again.';

    assert.ok(
      reason.startsWith(prefix),
      `permissionDecisionReason should start with instruction prefix, got: ${reason}`,
    );
    assert.ok(
      reason.endsWith(reviewText),
      `permissionDecisionReason should end with review result, got: ${reason}`,
    );
  });

  it('produces no stdout on adapter error (allows ExitPlanMode)', async () => {
    const deps = createDeps({
      getAdapter: () => ({
        review: async () => { throw new Error('API timeout'); },
      }),
    });

    await processHook(HOOK_INPUT, deps);

    assert.deepEqual(deps.stdoutChunks, []);
  });

  it('writes error message to stderr on adapter error', async () => {
    const deps = createDeps({
      getAdapter: () => ({
        review: async () => { throw new Error('API timeout'); },
      }),
    });

    await processHook(HOOK_INPUT, deps);

    const stderrOutput = deps.stderrChunks.join('');
    assert.ok(
      stderrOutput.includes('API timeout'),
      `stderr should contain the error message, got: ${stderrOutput}`,
    );
  });

  // ==================== stderr streaming ====================

  it('writes review header to stderr before calling adapter.review', async () => {
    const deps = createDeps();

    await processHook(HOOK_INPUT, deps);

    const stderrOutput = deps.stderrChunks.join('');
    assert.ok(
      stderrOutput.includes('━━━ Claude Plan Reviewer ━━━'),
      `stderr should contain review header, got: ${stderrOutput}`,
    );
    assert.ok(
      stderrOutput.includes('Reviewing with codex'),
      `stderr should mention the adapter name in header, got: ${stderrOutput}`,
    );
  });

  it('writes review footer to stderr after review completes', async () => {
    const deps = createDeps();

    await processHook(HOOK_INPUT, deps);

    const stderrOutput = deps.stderrChunks.join('');
    assert.ok(
      stderrOutput.includes('━━━ Review complete ━━━'),
      `stderr should contain review footer, got: ${stderrOutput}`,
    );
  });

  it('passes onData callback to adapter.review as 3rd argument', async () => {
    let capturedDeps = null;
    const deps = createDeps({
      getAdapter: () => ({
        review: async (prompt, options, reviewDeps) => {
          capturedDeps = reviewDeps;
          return 'LGTM';
        },
      }),
    });

    await processHook(HOOK_INPUT, deps);

    assert.notEqual(capturedDeps, null, 'adapter.review should have received a 3rd argument');
    assert.equal(
      typeof capturedDeps.onData,
      'function',
      `deps.onData should be a function, got: ${typeof capturedDeps?.onData}`,
    );
  });

  it('streams review chunks to stderr via onData', async () => {
    const deps = createDeps({
      getAdapter: () => ({
        review: async (prompt, options, reviewDeps) => {
          reviewDeps.onData('chunk1');
          reviewDeps.onData('chunk2');
          return 'LGTM';
        },
      }),
    });

    await processHook(HOOK_INPUT, deps);

    const stderrOutput = deps.stderrChunks.join('');
    assert.ok(
      stderrOutput.includes('chunk1'),
      `stderr should contain 'chunk1', got: ${stderrOutput}`,
    );
    assert.ok(
      stderrOutput.includes('chunk2'),
      `stderr should contain 'chunk2', got: ${stderrOutput}`,
    );
  });

  it('does not write review header when maxReviews reached', async () => {
    const deps = createDeps({
      getReviewCount: () => 2,
    });

    await processHook(HOOK_INPUT, deps);

    const stderrOutput = deps.stderrChunks.join('');
    assert.ok(
      !stderrOutput.includes('━━━ Claude Plan Reviewer ━━━'),
      `stderr should NOT contain review header when maxReviews reached, got: ${stderrOutput}`,
    );
  });

  it('does not write review header when no plan found', async () => {
    const deps = createDeps({
      findLatestPlan: () => null,
    });

    await processHook(HOOK_INPUT, deps);

    const stderrOutput = deps.stderrChunks.join('');
    assert.ok(
      !stderrOutput.includes('━━━ Claude Plan Reviewer ━━━'),
      `stderr should NOT contain review header when no plan found, got: ${stderrOutput}`,
    );
  });
});
