import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Returns true if the entry belongs to claude-plan-reviewer.
 */
function isCprEntry(entry) {
  if (entry.hooks?.some((h) => h.command?.includes("claude-plan-reviewer"))) return true;
  if (entry.command?.includes("claude-plan-reviewer")) return true;
  return false;
}

/**
 * Returns the hook command string: `node "<absolute_path_to_bin/cli.mjs>" hook`
 */
export function getHookCommand() {
  const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.mjs");
  if (!fs.existsSync(cliPath)) {
    throw new Error(`CLI entry point not found: ${cliPath}`);
  }
  return `node "${cliPath}" hook`;
}

/**
 * Registers the Stop hook in Claude's settings.json.
 * Creates the file if it does not exist. Preserves all existing settings and hooks.
 */
export function registerHook(settingsPath, hookCommand) {
  let settings = {};

  try {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    settings = JSON.parse(raw);
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw err;
    }
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }

  if (!Array.isArray(settings.hooks.Stop)) {
    settings.hooks.Stop = [];
  }

  const existingIndex = settings.hooks.Stop.findIndex(isCprEntry);

  const hookEntry = { hooks: [{ type: "command", command: hookCommand }] };

  if (existingIndex >= 0) {
    settings.hooks.Stop[existingIndex] = hookEntry;
  } else {
    settings.hooks.Stop.push(hookEntry);
  }

  // No mode specified — match Claude Code's own behavior for settings.json
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

/**
 * Removes the claude-plan-reviewer hook entry from Claude's settings.json.
 * If the file does not exist, does nothing.
 */
export function unregisterHook(settingsPath) {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }

  if (!settings.hooks?.Stop) return;

  const original = settings.hooks.Stop;
  const filtered = original.filter((entry) => !isCprEntry(entry));

  if (filtered.length === original.length) return;

  if (filtered.length === 0) {
    delete settings.hooks.Stop;
  } else {
    settings.hooks.Stop = filtered;
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  // No mode specified — match Claude Code's own behavior for settings.json
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}
