/**
 * Test module for src/adapters/registry.mjs
 *
 * Coverage:
 * - getAdapter is an exported function
 * - Returns an object with a review function for "codex"
 * - Returns an object with a review function for "gemini"
 * - Throws Error with "Unknown adapter: foo" for unknown adapter name
 * - Throws for empty string adapter name
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getAdapter } from "../../src/adapters/registry.mjs";

describe("adapter registry", () => {
  // ==================== Basic export ====================

  it("getAdapter is an exported function", () => {
    assert.equal(typeof getAdapter, "function");
  });

  // ==================== Known adapters ====================

  it('returns an object with a review function for "codex"', () => {
    const adapter = getAdapter("codex");
    assert.equal(typeof adapter, "object");
    assert.notEqual(adapter, null);
    assert.equal(typeof adapter.review, "function");
  });

  it('returns an object with a review function for "gemini"', () => {
    const adapter = getAdapter("gemini");
    assert.equal(typeof adapter, "object");
    assert.notEqual(adapter, null);
    assert.equal(typeof adapter.review, "function");
  });

  // ==================== Unknown adapter ====================

  it('throws Error with "Unknown adapter: foo" for unknown adapter name', () => {
    assert.throws(
      () => getAdapter("foo"),
      (err) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, "Unknown adapter: foo");
        return true;
      },
    );
  });

  // ==================== Empty string ====================

  it("throws for empty string adapter name", () => {
    assert.throws(
      () => getAdapter(""),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes("Unknown adapter:"),
          `Error message should include 'Unknown adapter:', got: ${err.message}`,
        );
        return true;
      },
    );
  });
});
