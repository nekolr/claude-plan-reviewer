/**
 * Process a Stop hook invocation from Claude Code.
 *
 * When Claude Code is about to stop (in plan mode), this hook:
 * 1. Reads stdin JSON from Claude Code
 * 2. Checks if permission_mode === "plan" and stop_hook_active is not true
 * 3. Checks review count hasn't exceeded maxReviews
 * 4. Finds the latest plan file
 * 5. Runs the review via the selected adapter
 * 6. Outputs {"decision":"block","reason":"..."} to stdout (blocks Claude's stop)
 * 7. On errors or when reviews exhausted, exits silently (allows Claude to stop)
 *
 * Convention: every early return MUST call no output to stdout
 * (absence of JSON output = allow stop).
 *
 * @param {object} input - Parsed JSON from Claude Code stdin
 * @param {string} input.session_id - The current session ID
 * @param {string} [input.permission_mode] - The current permission mode
 * @param {boolean} [input.stop_hook_active] - True if Claude is continuing due to a previous stop hook
 * @param {object} deps - Dependency injection container
 */
export async function processHook(input, deps) {
  try {
    // 1. If not in plan mode, allow Claude to stop
    if (input.permission_mode !== 'plan') {
      return;
    }

    // 2. Housekeeping: clean stale sessions
    deps.cleanStaleSessions();

    // 3. Load config
    const config = deps.loadConfig();

    // 4. Check review count against maxReviews
    const count = deps.getReviewCount(input.session_id);
    if (count >= config.maxReviews) {
      return;
    }

    // 5. Find latest plan file
    const plan = deps.findLatestPlan();
    if (plan === null) {
      return;
    }

    // 6. Build prompt
    const prompt = deps.buildPrompt(plan.content, config.prompt);

    // 7. Get adapter
    const adapter = deps.getAdapter(config.adapter);

    // 8. Run review
    const result = await adapter.review(prompt, config[config.adapter]);

    // 9. Increment review count
    deps.incrementReviewCount(input.session_id);

    // 10. Output block decision to stdout (Claude Code reads this)
    const output = JSON.stringify({ decision: "block", reason: result });
    deps.stdout.write(output + "\n");
  } catch (err) {
    // On any error, write to stderr and allow Claude to stop (no stdout = allow)
    deps.stderr.write(`[claude-plan-reviewer] Error: ${err.message}\n`);
  }
}
