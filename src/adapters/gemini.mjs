import { spawn as defaultSpawn } from "node:child_process";

/**
 * Runs the Gemini CLI to review a plan.
 *
 * @param {string} prompt - The review prompt to send via stdin.
 * @param {object} [options={}] - Configuration options.
 * @param {string} [options.model=""] - Gemini model to use (empty = default).
 * @param {number} [options.timeout=120000] - Timeout in milliseconds.
 * @param {object} [deps={ spawn: defaultSpawn }] - Dependency injection for testing.
 * @returns {Promise<string>} The review text (trimmed stdout).
 */
export async function review(prompt, options = {}, deps = { spawn: defaultSpawn }) {
  const { model = "", timeout = 120000 } = options;
  const { spawn } = deps;

  const args = [];
  if (model) {
    args.push("--model", model);
  }

  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const child = spawn("gemini", args, { signal: controller.signal });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    child.stdout.on("data", (data) => {
      stdout += data;
    });

    child.stderr.on("data", (data) => {
      stderr += data;
    });

    child.on("close", (code) => {
      if (code !== 0) {
        settle(
          reject,
          new Error(`Gemini review failed (exit ${code}): ${stderr.trim()}`)
        );
        return;
      }
      settle(resolve, stdout.trim());
    });

    child.on("error", (err) => {
      if (err.name === "AbortError") {
        settle(reject, new Error("Gemini review timed out"));
        return;
      }
      settle(reject, new Error(`Gemini review failed: ${err.message}`));
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
