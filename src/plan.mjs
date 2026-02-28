import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { homedir } from 'node:os';

/** Default directory where Claude Code stores plan files. */
export const PLANS_DIR = join(homedir(), '.claude', 'plans');

/** Default max age in milliseconds (5 minutes). */
const DEFAULT_MAX_AGE_MS = 300_000;

/**
 * Finds the most recently modified `.md` plan file in the given directory.
 *
 * @param {string} [plansDir=PLANS_DIR] - Directory to search for plan files.
 * @param {number} [maxAgeMs=300000] - Maximum age in ms for a plan to be considered current.
 * @returns {{ path: string, content: string } | null} The latest plan, or null if none qualifies.
 */
export function findLatestPlan(plansDir = PLANS_DIR, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  /** @type {string[]} */
  let entries;
  try {
    entries = readdirSync(plansDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }

  const mdFiles = entries.filter((name) => extname(name) === '.md');

  if (mdFiles.length === 0) {
    return null;
  }

  // Build array of { filePath, mtime } and sort by mtime descending
  const withStats = mdFiles.map((name) => {
    const filePath = join(plansDir, name);
    const stat = statSync(filePath);
    return { filePath, mtime: stat.mtimeMs };
  });

  withStats.sort((a, b) => b.mtime - a.mtime);

  const newest = withStats[0];

  // Check if the newest file is within the allowed max age
  if (Date.now() - newest.mtime > maxAgeMs) {
    return null;
  }

  const content = readFileSync(newest.filePath, 'utf-8');

  return { path: newest.filePath, content };
}
