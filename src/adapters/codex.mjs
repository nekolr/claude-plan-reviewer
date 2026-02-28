import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

/**
 * Runs the Codex CLI to review a plan.
 *
 * @param {string} prompt - The review prompt to send to Codex.
 * @param {object} [options] - Options for the review.
 * @param {string} [options.model=""] - Codex model to use (empty = default).
 * @param {string} [options.sandbox="read-only"] - Codex sandbox mode.
 * @param {number} [options.timeout=120000] - Timeout in ms.
 * @param {object} [deps] - Dependency injection for testing.
 * @param {Function} [deps.execFile] - The execFile function to use.
 * @returns {Promise<string>} The review text (trimmed).
 */
export async function review(prompt, options = {}, deps = { execFile: execFileAsync }) {
  const { model = "", sandbox = "read-only", timeout = 120000 } = options;

  const args = ["exec", prompt, "--sandbox", sandbox, "--full-auto"];
  if (model) {
    args.push("--model", model);
  }

  try {
    const { stdout } = await deps.execFile("codex", args, { timeout });
    return (stdout || "").trim();
  } catch (err) {
    if (err.signal === "SIGTERM") {
      throw new Error("Codex review timed out");
    }
    throw new Error(`Codex review failed: ${err.message}`);
  }
}
