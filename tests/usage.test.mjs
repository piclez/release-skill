import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { expect } from "./expect.mjs";
import { measureClaudeUsage as measureBranch } from "../skills/release/scripts/lib/usage.mjs";

const line = (branch, at, message, session = "s1") =>
  JSON.stringify({
    gitBranch: branch,
    sessionId: session,
    timestamp: at,
    ...(message
      ? {
          message: {
            id: message.id,
            content: message.command
              ? [{ type: "tool_use", name: "Bash", input: { command: message.command } }]
              : [],
            usage: {
              input_tokens: message.input ?? 0,
              output_tokens: message.output ?? 0,
              cache_read_input_tokens: message.read ?? 0,
              cache_creation_input_tokens: message.write ?? 0,
            },
          },
        }
      : {}),
  });

describe("measureBranch", () => {
  const dir = mkdtempSync(join(tmpdir(), "releases-"));
  mkdirSync(join(dir, "session-a", "subagents"), { recursive: true });
  writeFileSync(
    join(dir, "session-a.jsonl"),
    [
      line("feat/x", "2026-10-21T10:00:00Z"),
      // One message written as two content blocks: its usage counts once.
      line("feat/x", "2026-10-21T10:05:00Z", {
        id: "m1",
        input: 10,
        output: 100,
        read: 1000,
        write: 50,
      }),
      line("feat/x", "2026-10-21T10:05:01Z", {
        id: "m1",
        input: 10,
        output: 100,
        read: 1000,
        write: 50,
      }),
      line("main", "2026-10-21T10:06:00Z", { id: "m2", output: 999 }),
      // An hour away from the keyboard: not active time.
      line("feat/x", "2026-10-21T11:30:00Z", { id: "m3", output: 5, command: "git commit -m x" }),
      "not json",
    ].join("\n"),
  );
  // A subagent carries its parent's session id, so it counts with the parent.
  writeFileSync(
    join(dir, "session-a", "subagents", "agent-1.jsonl"),
    line("feat/x", "2026-10-21T11:40:00Z", { id: "m4", input: 1, output: 2 }),
  );
  // Another session sharing the checkout while feat/x was out: tagged, but it never
  // committed, pushed or touched the PR, so none of it counts.
  const bystander = mkdtempSync(join(tmpdir(), "releases-b-"));
  writeFileSync(
    join(bystander, "session-b.jsonl"),
    [
      line(
        "feat/x",
        "2026-10-21T10:10:00Z",
        { id: "b1", output: 7777, command: "pnpm test" },
        "s2",
      ),
      line("feat/x", "2026-10-21T10:20:00Z", { id: "b2", output: 1 }, "s2"),
    ].join("\n"),
  );
  // A review session that only ran `gh pr view` on the PR counts.
  writeFileSync(
    join(dir, "session-c.jsonl"),
    line(
      "feat/x",
      "2026-10-22T09:00:00Z",
      { id: "c1", output: 3, command: "gh pr view 7 --json state" },
      "s3",
    ),
  );

  it("sums each message once, only for sessions that worked on the branch", () => {
    const measured = measureBranch("feat/x", 7, [dir, bystander]);
    expect(measured?.tokens).toEqual({
      input: 11,
      output: 110,
      cacheRead: 1000,
      cacheWrite: 50,
      total: 1171,
    });
    expect(measured?.sessions).toBe(2);
    // Without the PR number the review session has nothing tying it to the branch.
    expect(measureBranch("feat/x", null, [dir, bystander])?.tokens.total).toBe(1168);
  });

  it("reads only the asked time window", () => {
    const window = {
      since: new Date("2026-10-21T11:00:00Z"),
      until: new Date("2026-10-21T12:00:00Z"),
    };
    expect(measureBranch("feat/x", 7, [dir, bystander], window)?.tokens.total).toBe(8);
  });

  it("returns null for a branch with no session logs", () => {
    expect(measureBranch("feat/never", null, [dir])).toBeNull();
  });

  it("ignores a tagged session that never committed, pushed or opened the PR", () => {
    expect(measureBranch("feat/x", 7, [bystander])).toBeNull();
  });
});
