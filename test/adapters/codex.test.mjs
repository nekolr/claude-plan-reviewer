/**
 * Test module for src/adapters/codex.mjs
 *
 * Coverage:
 * - review is an exported async function
 * - Calls codex with correct arguments (exec, prompt, --sandbox, --full-auto)
 * - Returns trimmed stdout from codex
 * - Includes --model flag when model option is provided
 * - Uses "read-only" as default sandbox
 * - Uses custom sandbox when provided
 * - Throws on execFile error (e.g., codex not found)
 * - Throws on timeout (signal === 'SIGTERM')
 * - Returns empty string when stdout is empty
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { review } from "../../src/adapters/codex.mjs";

/**
 * Creates a mock execFile function that captures calls and returns configurable results.
 * @param {object|Error} result - The result to return, or an Error to throw.
 * @returns {Function & { calls: Array<{ cmd: string, args: string[], options: object }> }}
 */
function createMockExecFile(result = { stdout: "LGTM", stderr: "" }) {
  const calls = [];
  const fn = async (cmd, args, options) => {
    calls.push({ cmd, args, options });
    if (result instanceof Error) throw result;
    return result;
  };
  fn.calls = calls;
  return fn;
}

describe("codex adapter", () => {
  // ==================== Basic export ====================

  it("review is an exported async function", () => {
    assert.equal(typeof review, "function");
    // AsyncFunction check
    const result = review("test", {}, { execFile: createMockExecFile() });
    assert.ok(result instanceof Promise, "review should return a Promise");
  });

  // ==================== Correct arguments ====================

  it("calls codex with correct arguments (exec, prompt, --sandbox, --full-auto)", async () => {
    const mockExecFile = createMockExecFile({ stdout: "looks good", stderr: "" });

    await review("Please review this plan", {}, { execFile: mockExecFile });

    assert.equal(mockExecFile.calls.length, 1);
    const { cmd, args } = mockExecFile.calls[0];
    assert.equal(cmd, "codex");
    assert.deepEqual(args, [
      "exec",
      "Please review this plan",
      "--sandbox",
      "read-only",
      "--full-auto",
    ]);
  });

  // ==================== Returns trimmed stdout ====================

  it("returns trimmed stdout from codex", async () => {
    const mockExecFile = createMockExecFile({
      stdout: "  LGTM with minor nits  \n",
      stderr: "",
    });

    const result = await review("review this", {}, { execFile: mockExecFile });
    assert.equal(result, "LGTM with minor nits");
  });

  // ==================== --model flag ====================

  it("includes --model flag when model option is provided", async () => {
    const mockExecFile = createMockExecFile({ stdout: "ok", stderr: "" });

    await review("review", { model: "o3" }, { execFile: mockExecFile });

    const { args } = mockExecFile.calls[0];
    assert.deepEqual(args, [
      "exec",
      "review",
      "--sandbox",
      "read-only",
      "--full-auto",
      "--model",
      "o3",
    ]);
  });

  // ==================== Default sandbox ====================

  it('uses "read-only" as default sandbox', async () => {
    const mockExecFile = createMockExecFile({ stdout: "ok", stderr: "" });

    await review("review", {}, { execFile: mockExecFile });

    const { args } = mockExecFile.calls[0];
    const sandboxIndex = args.indexOf("--sandbox");
    assert.notEqual(sandboxIndex, -1, "args should contain --sandbox");
    assert.equal(args[sandboxIndex + 1], "read-only");
  });

  // ==================== Custom sandbox ====================

  it("uses custom sandbox when provided", async () => {
    const mockExecFile = createMockExecFile({ stdout: "ok", stderr: "" });

    await review("review", { sandbox: "network" }, { execFile: mockExecFile });

    const { args } = mockExecFile.calls[0];
    const sandboxIndex = args.indexOf("--sandbox");
    assert.notEqual(sandboxIndex, -1, "args should contain --sandbox");
    assert.equal(args[sandboxIndex + 1], "network");
  });

  // ==================== Error handling ====================

  it("throws on execFile error (e.g., codex not found)", async () => {
    const error = new Error("spawn codex ENOENT");
    error.code = "ENOENT";
    const mockExecFile = createMockExecFile(error);

    await assert.rejects(
      () => review("review", {}, { execFile: mockExecFile }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes("Codex review failed"),
          `Error message should include 'Codex review failed', got: ${err.message}`
        );
        return true;
      }
    );
  });

  // ==================== Timeout ====================

  it("throws on timeout (signal === 'SIGTERM')", async () => {
    const error = new Error("Process timed out");
    error.signal = "SIGTERM";
    const mockExecFile = createMockExecFile(error);

    await assert.rejects(
      () => review("review", {}, { execFile: mockExecFile }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes("timed out"),
          `Error message should include 'timed out', got: ${err.message}`
        );
        return true;
      }
    );
  });

  // ==================== Passes timeout to execFile ====================

  it("passes timeout option to execFile", async () => {
    const mockExecFile = createMockExecFile({ stdout: "ok", stderr: "" });

    await review("review", { timeout: 60000 }, { execFile: mockExecFile });

    const { options } = mockExecFile.calls[0];
    assert.equal(options.timeout, 60000);
  });

  it("uses default timeout of 120000 when not specified", async () => {
    const mockExecFile = createMockExecFile({ stdout: "ok", stderr: "" });

    await review("review", {}, { execFile: mockExecFile });

    const { options } = mockExecFile.calls[0];
    assert.equal(options.timeout, 120000);
  });

  // ==================== Empty stdout ====================

  it("returns empty string when stdout is empty", async () => {
    const mockExecFile = createMockExecFile({ stdout: "", stderr: "" });

    const result = await review("review", {}, { execFile: mockExecFile });
    assert.equal(result, "");
  });

  it("returns empty string when stdout is only whitespace", async () => {
    const mockExecFile = createMockExecFile({ stdout: "   \n\n  ", stderr: "" });

    const result = await review("review", {}, { execFile: mockExecFile });
    assert.equal(result, "");
  });
});
