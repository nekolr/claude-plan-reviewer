/**
 * Test module for setup.mjs
 *
 * Coverage:
 * - getHookCommand returns correct command string
 * - registerHook creates, updates, and preserves settings.json
 * - unregisterHook removes claude-plan-reviewer entries correctly
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getHookCommand, registerHook, unregisterHook } from "../src/setup.mjs";

// ==================== getHookCommand ====================

describe("getHookCommand", () => {
  it("should return a string", () => {
    const cmd = getHookCommand();
    assert.equal(typeof cmd, "string");
  });

  it("should start with 'node '", () => {
    const cmd = getHookCommand();
    assert.ok(cmd.startsWith("node "), `Expected to start with 'node ', got: ${cmd}`);
  });

  it("should contain 'cli.mjs'", () => {
    const cmd = getHookCommand();
    assert.ok(cmd.includes("cli.mjs"), `Expected to contain 'cli.mjs', got: ${cmd}`);
  });

  it("should end with ' hook'", () => {
    const cmd = getHookCommand();
    assert.ok(cmd.endsWith(" hook"), `Expected to end with ' hook', got: ${cmd}`);
  });

  it("should wrap the path in double quotes", () => {
    const cmd = getHookCommand();
    // Pattern: node "...path..." hook
    assert.match(cmd, /^node ".*" hook$/, `Expected path wrapped in double quotes, got: ${cmd}`);
  });

  it("should contain an absolute path", () => {
    const cmd = getHookCommand();
    // Extract path between quotes
    const match = cmd.match(/^node "(.*)" hook$/);
    assert.ok(match, `Expected 'node "..." hook' pattern, got: ${cmd}`);
    assert.ok(path.isAbsolute(match[1]), `Expected absolute path, got: ${match[1]}`);
  });

  it("should contain a path ending with bin/cli.mjs", () => {
    const cmd = getHookCommand();
    const match = cmd.match(/^node "(.*)" hook$/);
    assert.ok(match, `Expected 'node "..." hook' pattern, got: ${cmd}`);
    assert.ok(
      match[1].endsWith(path.join("bin", "cli.mjs")),
      `Expected path ending with bin/cli.mjs, got: ${match[1]}`
    );
  });
});

// ==================== registerHook ====================

describe("registerHook", () => {
  let tmpDir;
  let settingsPath;
  const hookCommand = 'node "/path/to/claude-plan-reviewer/bin/cli.mjs" hook';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-setup-test-"));
    settingsPath = path.join(tmpDir, "settings.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should create settings.json if it does not exist", () => {
    assert.ok(!fs.existsSync(settingsPath), "settings.json should not exist before test");

    registerHook(settingsPath, hookCommand);

    assert.ok(fs.existsSync(settingsPath), "settings.json should be created");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert.ok(settings.hooks, "settings should have hooks");
    assert.ok(Array.isArray(settings.hooks.Stop), "settings.hooks.Stop should be an array");
  });

  it("should preserve existing settings when adding hook", () => {
    const existingSettings = {
      theme: "dark",
      language: "en",
    };
    fs.writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));

    registerHook(settingsPath, hookCommand);

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert.equal(settings.theme, "dark");
    assert.equal(settings.language, "en");
    assert.ok(settings.hooks.Stop, "Stop hook should be added");
  });

  it("should preserve other hooks when setting Stop", () => {
    const existingSettings = {
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "some-tool" }] }],
        PermissionRequest: [{ hooks: [{ type: "command", command: "some-approver" }] }],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));

    registerHook(settingsPath, hookCommand);

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert.deepEqual(settings.hooks.PreToolUse, existingSettings.hooks.PreToolUse);
    assert.deepEqual(settings.hooks.PermissionRequest, existingSettings.hooks.PermissionRequest);
    assert.ok(Array.isArray(settings.hooks.Stop), "Stop should be added alongside existing hooks");
  });

  it("should set Stop to correct hook structure", () => {
    registerHook(settingsPath, hookCommand);

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const stopEntries = settings.hooks.Stop;
    assert.equal(stopEntries.length, 1);
    assert.deepEqual(stopEntries[0], {
      hooks: [{ type: "command", command: hookCommand }],
    });
  });

  it("should update existing claude-plan-reviewer hook in place", () => {
    const oldCommand = 'node "/old/path/claude-plan-reviewer/bin/cli.mjs" hook';
    const existingSettings = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: oldCommand }] }],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));

    registerHook(settingsPath, hookCommand);

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const stopEntries = settings.hooks.Stop;
    assert.equal(stopEntries.length, 1, "Should update in place, not append");
    assert.deepEqual(stopEntries[0], {
      hooks: [{ type: "command", command: hookCommand }],
    });
  });

  it("should preserve existing non-claude-plan-reviewer Stop hooks", () => {
    const osascriptHook = { hooks: [{ type: "command", command: "osascript -e 'say done'" }] };
    const existingSettings = {
      hooks: {
        Stop: [osascriptHook],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));

    registerHook(settingsPath, hookCommand);

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const stopEntries = settings.hooks.Stop;
    assert.equal(stopEntries.length, 2, "Should have both hooks");
    assert.deepEqual(stopEntries[0], osascriptHook, "osascript hook should be preserved");
    assert.deepEqual(stopEntries[1], {
      hooks: [{ type: "command", command: hookCommand }],
    });
  });

  it("should handle coexistence with existing Stop hooks", () => {
    const osascriptHook = { hooks: [{ type: "command", command: "osascript -e 'say done'" }] };
    const oldCprHook = { hooks: [{ type: "command", command: 'node "/old/claude-plan-reviewer/bin/cli.mjs" hook' }] };
    const existingSettings = {
      hooks: {
        Stop: [osascriptHook, oldCprHook],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));

    registerHook(settingsPath, hookCommand);

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const stopEntries = settings.hooks.Stop;
    assert.equal(stopEntries.length, 2, "Should still have exactly 2 hooks");
    assert.deepEqual(stopEntries[0], osascriptHook, "osascript hook should remain at index 0");
    assert.deepEqual(stopEntries[1], {
      hooks: [{ type: "command", command: hookCommand }],
    }, "claude-plan-reviewer hook should be updated at index 1");
  });
});

// ==================== unregisterHook ====================

describe("unregisterHook", () => {
  let tmpDir;
  let settingsPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-setup-test-"));
    settingsPath = path.join(tmpDir, "settings.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should do nothing when settings file does not exist", () => {
    assert.doesNotThrow(() => unregisterHook(settingsPath));
    assert.ok(!fs.existsSync(settingsPath), "settings.json should not be created");
  });

  it("should do nothing when settings has no hooks", () => {
    const settings = { theme: "dark" };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    unregisterHook(settingsPath);

    const result = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert.deepEqual(result, settings, "Settings should remain unchanged");
  });

  it("should do nothing when settings has no Stop", () => {
    const settings = {
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "some-tool" }] }],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    unregisterHook(settingsPath);

    const result = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert.deepEqual(result, settings, "Settings should remain unchanged");
  });

  it("should remove only claude-plan-reviewer entries from Stop", () => {
    const osascriptHook = { hooks: [{ type: "command", command: "osascript -e 'say done'" }] };
    const cprHook = { hooks: [{ type: "command", command: 'node "/path/to/claude-plan-reviewer/bin/cli.mjs" hook' }] };
    const settings = {
      hooks: {
        Stop: [osascriptHook, cprHook],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    unregisterHook(settingsPath);

    const result = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert.deepEqual(result.hooks.Stop, [osascriptHook], "Only osascript hook should remain");
  });

  it("should preserve other hook types when removing Stop entries", () => {
    const preToolHook = [{ hooks: [{ type: "command", command: "lint-check" }] }];
    const cprHook = { hooks: [{ type: "command", command: 'node "/path/to/claude-plan-reviewer/bin/cli.mjs" hook' }] };
    const settings = {
      hooks: {
        PreToolUse: preToolHook,
        Stop: [cprHook],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    unregisterHook(settingsPath);

    const result = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert.deepEqual(result.hooks.PreToolUse, preToolHook, "PreToolUse should be preserved");
    assert.equal(result.hooks.Stop, undefined, "Stop should be deleted when empty");
  });

  it("should delete Stop key when array becomes empty", () => {
    const cprHook = { hooks: [{ type: "command", command: 'node "/path/to/claude-plan-reviewer/bin/cli.mjs" hook' }] };
    const settings = {
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "lint" }] }],
        Stop: [cprHook],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    unregisterHook(settingsPath);

    const result = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert.ok(!("Stop" in result.hooks), "Stop key should be deleted");
    assert.ok("PreToolUse" in result.hooks, "PreToolUse should still exist");
  });

  it("should delete hooks key when it becomes empty", () => {
    const cprHook = { hooks: [{ type: "command", command: 'node "/path/to/claude-plan-reviewer/bin/cli.mjs" hook' }] };
    const settings = {
      theme: "dark",
      hooks: {
        Stop: [cprHook],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    unregisterHook(settingsPath);

    const result = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert.ok(!("hooks" in result), "hooks key should be deleted when empty");
    assert.equal(result.theme, "dark", "Other settings should be preserved");
  });

  it("should handle legacy flat format entries", () => {
    const legacyEntry = { command: 'node "/path/to/claude-plan-reviewer/bin/cli.mjs" hook' };
    const osascriptHook = { hooks: [{ type: "command", command: "osascript -e 'say done'" }] };
    const settings = {
      hooks: {
        Stop: [legacyEntry, osascriptHook],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    unregisterHook(settingsPath);

    const result = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert.deepEqual(result.hooks.Stop, [osascriptHook], "Only osascript hook should remain after removing legacy entry");
  });
});
