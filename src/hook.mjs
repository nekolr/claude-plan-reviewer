/**
 * Process a Stop hook invocation from Claude Code.
 *
 * When Claude Code is about to stop (in plan mode), this hook:
 * 1. Reads stdin JSON from Claude Code
 * 2. Checks if permission_mode === "plan"
 * 3. Checks review count hasn't exceeded maxReviews
 * 4. Finds the latest plan file
 * 5. Runs the review via the selected adapter
 * 6. Outputs review result to stderr + exits with code 2 (blocks Claude's stop)
 * 7. On errors or when maxReviews reached, exits with code 0 (allows Claude to stop)
 *
 * Convention: every `deps.exit()` call MUST be followed by `return`
 * because `deps.exit` may be a mock in tests that doesn't halt execution.
 *
 * @param {object} input - Parsed JSON from Claude Code stdin
 * @param {string} input.session_id - The current session ID
 * @param {string} [input.permission_mode] - The current permission mode
 * @param {object} deps - Dependency injection container
 */
export async function processHook(input, deps) {
  try {
    // 1. If not in plan mode, allow Claude to stop
    if (input.permission_mode !== 'plan') {
      deps.exit(0);
      return;
    }

    // 2. Housekeeping: clean stale sessions
    deps.cleanStaleSessions();

    // 3. Load config
    const config = deps.loadConfig();

    // 4. Check review count against maxReviews
    const count = deps.getReviewCount(input.session_id);
    if (count >= config.maxReviews) {
      deps.exit(0);
      return;
    }

    // 5. Find latest plan file
    const plan = deps.findLatestPlan();
    if (plan === null) {
      deps.exit(0);
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

    // 10. Write result to stderr
    deps.stderr.write(result);

    // 11. Exit with code 2 to block Claude's stop and inject review
    deps.exit(2);
  } catch (err) {
    // On any error, write to stderr and allow Claude to stop
    deps.stderr.write(`[claude-plan-reviewer] Error: ${err.message}\n`);
    deps.exit(0);
  }
}
