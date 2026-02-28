/**
 * Builds the review prompt sent to external AI CLIs.
 *
 * @param {string} planContent - The implementation plan text to review.
 * @param {string} [customPrompt] - Optional additional review instructions.
 * @returns {string} The assembled prompt string.
 */
export function buildPrompt(planContent, customPrompt) {
  const base = `You are reviewing an implementation plan created by Claude Code (an AI coding assistant). Analyze the plan critically and provide actionable feedback.

## Plan to Review

${planContent}

## Review Criteria

1. **Missing edge cases**: Are there scenarios the plan doesn't account for?
2. **Architectural concerns**: Are there design decisions that could cause problems?
3. **Security issues**: Are there potential security vulnerabilities?
4. **Performance concerns**: Are there potential performance bottlenecks?
5. **Error handling**: Are failure modes properly addressed?
6. **Dependencies**: Are there missing or unnecessary dependencies?`;

  const customSection =
    typeof customPrompt === "string" && customPrompt.length > 0
      ? `\n\n## Additional Review Instructions\n\n${customPrompt}`
      : "";

  const instructions = `

## Instructions

- If the plan is solid and well-thought-out, respond with "LGTM" and a brief explanation.
- If there are improvements needed, list them as actionable items with specific suggestions.
- Be concise and focus on substantive issues, not style preferences.
- Format your response as a numbered list of findings, or "LGTM" if no issues found.`;

  return base + customSection + instructions;
}
