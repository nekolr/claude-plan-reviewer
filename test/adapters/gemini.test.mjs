/**
 * Test module for src/adapters/gemini.mjs
 *
 * Coverage:
 * - review is an exported async function
 * - Calls gemini with no args by default
 * - Returns trimmed stdout from gemini
 * - Includes --model flag when model option is provided
 * - Writes prompt to child's stdin
 * - Throws on non-zero exit code with stderr message
 * - Throws on spawn error (e.g., gemini not found)
 * - Returns empty string when stdout is empty
 * - Passes AbortSignal (not timeout) to spawn for timeout support
 * - Rejects with 'timed out' message on AbortError
 * - Settle guard prevents double resolution when both error and close fire
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { review } from "../../src/adapters/gemini.mjs";

/**
 * Creates a mock spawn function that simulates child_process.spawn.
 * Returns a fake child process with stdin/stdout/stderr streams.
 *
 * @param {object} result - The result configuration.
 * @param {string} [result.stdout="LGTM"] - Data to emit on stdout.
 * @param {string} [result.stderr=""] - Data to emit on stderr.
 * @param {number} [result.code=0] - Exit code for the child process.
 * @param {Error} [result.error] - If set, emit an 'error' event instead of 'close'.
 * @returns {Function & { calls: Array<{ cmd: string, args: string[], options: object, child: EventEmitter }> }}
 */
function createMockSpawn(result = { stdout: "LGTM", code: 0 }) {
  const calls = [];
  const fn = (cmd, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};

    calls.push({ cmd, args, options, child });

    process.nextTick(() => {
      if (result.error) {
        child.emit("error", result.error);
        return;
      }
      if (result.stdout) child.stdout.push(result.stdout);
      child.stdout.push(null);
      if (result.stderr) child.stderr.push(result.stderr);
      child.stderr.push(null);
      child.emit("close", result.code ?? 0);
    });

    return child;
  };
  fn.calls = calls;
  return fn;
}

describe("gemini adapter", () => {
  // ==================== Basic export ====================

  it("review is an exported async function", () => {
    assert.equal(typeof review, "function");
    const result = review("test", {}, { spawn: createMockSpawn() });
    assert.ok(result instanceof Promise, "review should return a Promise");
  });

  // ==================== Correct arguments ====================

  it("calls gemini with no args by default", async () => {
    const mockSpawn = createMockSpawn({ stdout: "looks good", code: 0 });

    await review("Please review this plan", {}, { spawn: mockSpawn });

    assert.equal(mockSpawn.calls.length, 1);
    const { cmd, args } = mockSpawn.calls[0];
    assert.equal(cmd, "gemini");
    assert.deepEqual(args, []);
  });

  // ==================== Returns trimmed stdout ====================

  it("returns trimmed stdout from gemini", async () => {
    const mockSpawn = createMockSpawn({
      stdout: "  LGTM with minor nits  \n",
      code: 0,
    });

    const result = await review("review this", {}, { spawn: mockSpawn });
    assert.equal(result, "LGTM with minor nits");
  });

  // ==================== --model flag ====================

  it("includes --model flag when model option is provided", async () => {
    const mockSpawn = createMockSpawn({ stdout: "ok", code: 0 });

    await review("review", { model: "gemini-2.5-pro" }, { spawn: mockSpawn });

    const { args } = mockSpawn.calls[0];
    assert.deepEqual(args, ["--model", "gemini-2.5-pro"]);
  });

  it("does not include --model flag when model is empty string", async () => {
    const mockSpawn = createMockSpawn({ stdout: "ok", code: 0 });

    await review("review", { model: "" }, { spawn: mockSpawn });

    const { args } = mockSpawn.calls[0];
    assert.deepEqual(args, []);
  });

  it("sets spawn cwd when projectPath is provided", async () => {
    const mockSpawn = createMockSpawn({ stdout: "ok", code: 0 });

    await review("review", { projectPath: "/repo/path" }, { spawn: mockSpawn });

    const { options } = mockSpawn.calls[0];
    assert.equal(options.cwd, "/repo/path");
  });

  // ==================== Writes prompt to stdin ====================

  it("writes prompt to child's stdin", async () => {
    const mockSpawn = createMockSpawn({ stdout: "ok", code: 0 });

    const prompt = "Please review the following plan:\n# My Plan\n- Step 1";
    await review(prompt, {}, { spawn: mockSpawn });

    const { child } = mockSpawn.calls[0];
    // Read what was written to stdin
    const stdinData = child.stdin.read();
    assert.ok(stdinData !== null, "prompt should have been written to stdin");
    assert.equal(stdinData.toString(), prompt);
  });

  // ==================== Non-zero exit code ====================

  it("throws on non-zero exit code with stderr message", async () => {
    const mockSpawn = createMockSpawn({
      stdout: "",
      stderr: "Error: model not found",
      code: 1,
    });

    await assert.rejects(
      () => review("review", {}, { spawn: mockSpawn }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes("Gemini review failed"),
          `Error message should include 'Gemini review failed', got: ${err.message}`
        );
        assert.ok(
          err.message.includes("Error: model not found"),
          `Error message should include stderr content, got: ${err.message}`
        );
        return true;
      }
    );
  });

  // ==================== Spawn error ====================

  it("throws on spawn error (e.g., gemini not found)", async () => {
    const spawnError = new Error("spawn gemini ENOENT");
    spawnError.code = "ENOENT";
    const mockSpawn = createMockSpawn({ error: spawnError });

    await assert.rejects(
      () => review("review", {}, { spawn: mockSpawn }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes("Gemini review failed"),
          `Error message should include 'Gemini review failed', got: ${err.message}`
        );
        return true;
      }
    );
  });

  // ==================== Empty stdout ====================

  it("returns empty string when stdout is empty", async () => {
    const mockSpawn = createMockSpawn({ stdout: "", code: 0 });

    const result = await review("review", {}, { spawn: mockSpawn });
    assert.equal(result, "");
  });

  it("returns empty string when stdout is only whitespace", async () => {
    const mockSpawn = createMockSpawn({ stdout: "   \n\n  ", code: 0 });

    const result = await review("review", {}, { spawn: mockSpawn });
    assert.equal(result, "");
  });

  // ==================== Timeout via AbortController ====================

  it("passes an AbortSignal to spawn instead of timeout", async () => {
    const mockSpawn = createMockSpawn({ stdout: "ok", code: 0 });

    await review("review", { timeout: 60000 }, { spawn: mockSpawn });

    const { options } = mockSpawn.calls[0];
    assert.ok(
      options.signal instanceof AbortSignal,
      "spawn options should contain an AbortSignal"
    );
    assert.equal(options.timeout, undefined, "timeout should NOT be passed to spawn");
  });

  it("passes an AbortSignal even when timeout is not specified", async () => {
    const mockSpawn = createMockSpawn({ stdout: "ok", code: 0 });

    await review("review", {}, { spawn: mockSpawn });

    const { options } = mockSpawn.calls[0];
    assert.ok(
      options.signal instanceof AbortSignal,
      "spawn options should contain an AbortSignal"
    );
  });

  it("rejects with 'timed out' message when AbortError is emitted", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    const mockSpawn = createMockSpawn({ error: abortError });

    await assert.rejects(
      () => review("review", {}, { spawn: mockSpawn }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, "Gemini review timed out");
        return true;
      }
    );
  });

  // ==================== onData callback ====================

  it("calls onData for each stdout chunk", async () => {
    const mockSpawn = createMockSpawn({ stdout: "review output", code: 0 });
    const onDataCalls = [];
    const onData = (data) => onDataCalls.push(data);

    await review("review", {}, { spawn: mockSpawn, onData });

    assert.ok(
      onDataCalls.length > 0,
      `onData should have been called at least once, got ${onDataCalls.length} calls`
    );
    const combined = onDataCalls.map(String).join("");
    assert.ok(
      combined.includes("review output"),
      `onData calls should contain stdout data, got: ${combined}`
    );
  });

  // ==================== Settle guard ====================

  it("does not resolve after an error has already been emitted", async () => {
    // Simulate both error and close events firing (settle guard)
    const calls = [];
    const mockSpawn = (cmd, args, options) => {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};

      calls.push({ cmd, args, options, child });

      process.nextTick(() => {
        child.emit("error", new Error("something broke"));
        // After error, close also fires (common Node.js behavior)
        child.stdout.push(null);
        child.stderr.push(null);
        child.emit("close", 0);
      });

      return child;
    };

    await assert.rejects(
      () => review("review", {}, { spawn: mockSpawn }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("Gemini review failed"));
        return true;
      }
    );
  });
});
