import { spawn as defaultSpawn } from "node:child_process";

/**
 * Runs the Codex CLI to review a plan.
 *
 * @param {string} prompt - The review prompt to send to Codex.
 * @param {object} [options] - Options for the review.
 * @param {string} [options.model=""] - Codex model to use (empty = default).
 * @param {string} [options.sandbox="read-only"] - Codex sandbox mode.
 * @param {number} [options.timeout=120000] - Timeout in ms.
 * @param {object} [deps] - Dependency injection for testing.
 * @param {Function} [deps.spawn] - The spawn function to use.
 * @param {Function} [deps.onData] - Callback for each stdout chunk (for streaming).
 * @returns {Promise<string>} The review text (trimmed).
 */
export async function review(prompt, options = {}, deps = {}) {
  const { spawn = defaultSpawn, onData = () => {} } = deps;
  const { model = "", sandbox = "read-only", timeout = 120000 } = options;

  const args = ["exec", prompt, "--sandbox", sandbox, "--full-auto"];
  if (model) {
    args.push("--model", model);
  }

  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const child = spawn("codex", args, { signal: controller.signal });

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
      onData(data);
    });

    child.stderr.on("data", (data) => {
      stderr += data;
    });

    child.on("close", (code) => {
      if (code !== 0) {
        settle(
          reject,
          new Error(`Codex review failed (exit ${code ?? "signal"}): ${stderr.trim()}`)
        );
        return;
      }
      settle(resolve, stdout.trim());
    });

    child.on("error", (err) => {
      if (err.name === "AbortError") {
        settle(reject, new Error("Codex review timed out"));
        return;
      }
      settle(reject, new Error(`Codex review failed: ${err.message}`));
    });
  });
}
