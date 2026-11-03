import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Claude Code keeps one folder per working directory, named after its path with every
 * non-alphanumeric character turned into "-". Worktrees of the repo (<repo>-*) get their
 * own folders, so all of them are read.
 */
export function transcriptDirs() {
  if (process.env.RELEASES_TRANSCRIPTS_DIR) return [process.env.RELEASES_TRANSCRIPTS_DIR];
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  const prefix = dirname(common).replace(/[^a-zA-Z0-9]/g, "-");
  const projects = join(homedir(), ".claude", "projects");
  if (!existsSync(projects)) return [];
  return readdirSync(projects)
    .filter((name) => name === prefix || name.startsWith(`${prefix}-`))
    .map((name) => join(projects, name));
}

function* jsonlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* jsonlFiles(path);
    else if (name.endsWith(".jsonl")) yield path;
  }
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function* commands(row) {
  const content = row.message?.content;
  if (!Array.isArray(content)) return;
  for (const item of content) {
    if (item?.type === "tool_use" && typeof item.input?.command === "string")
      yield item.input.command;
  }
}

/**
 * Claude tokens spent on `branch`, subagents included. Hours are not measured from the
 * logs: they are an estimate a person approves for each entry.
 *
 * Every session line is tagged with the branch checked out at that moment, and parallel
 * sessions often share one checkout, so a tag alone does not say whose work it was. A
 * session counts only when it worked on the branch itself: it committed, pushed or opened
 * the PR while on it, created or switched to it, or ran a `gh pr` command on the PR.
 * An assistant message is written once per content block with the same usage repeated,
 * so usage is counted once per message id.
 */
export function measureClaudeUsage(branch, pr = null, dirs = transcriptDirs(), window = {}) {
  const b = escape(branch);
  const onBranchWork = /\bgit\s+(commit|push)\b|\bgh\s+pr\s+create\b/;
  const namesBranch = new RegExp(
    [
      `\\bgit\\s+(switch|checkout)\\s+(-[cbB]\\s+)?${b}(?![\\w/.-])`,
      `\\bgit\\s+push\\b.*${b}(?![\\w/.-])`,
      `--head\\s+${b}(?![\\w/.-])`,
      ...(pr ? [`\\bgh\\s+pr\\s+\\w+\\s+#?${pr}\\b`, `/pull/${pr}\\b`] : []),
    ].join("|"),
  );

  const owners = new Set();
  const tagged = [];
  for (const dir of dirs) {
    for (const file of jsonlFiles(dir)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const mayOwn = line.includes('"tool_use"');
        if (!mayOwn && !line.includes(`"gitBranch":"${branch}"`)) continue;
        let row;
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        const on = row.gitBranch === branch;
        if (on) tagged.push(row);
        if (!row.sessionId || owners.has(row.sessionId)) continue;
        for (const command of commands(row)) {
          if ((on && onBranchWork.test(command)) || namesBranch.test(command)) {
            owners.add(row.sessionId);
            break;
          }
        }
      }
    }
  }

  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const counted = new Set();
  const sessions = new Set();
  for (const row of tagged) {
    if (!row.sessionId || !owners.has(row.sessionId)) continue;
    const at = row.timestamp ? Date.parse(row.timestamp) : NaN;
    if (window.since && !(at >= window.since.getTime())) continue;
    if (window.until && !(at < window.until.getTime())) continue;
    sessions.add(row.sessionId);
    const usage = row.message?.usage;
    const id = row.message?.id;
    if (!usage || !id || counted.has(id)) continue;
    counted.add(id);
    tokens.input += usage.input_tokens ?? 0;
    tokens.output += usage.output_tokens ?? 0;
    tokens.cacheRead += usage.cache_read_input_tokens ?? 0;
    tokens.cacheWrite += usage.cache_creation_input_tokens ?? 0;
  }
  if (!counted.size) return null;
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;

  return { tokens, sessions: sessions.size };
}
