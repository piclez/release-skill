# Plan: release skill

## Goal

A Claude Code skill that keeps a client's delivery log. Each PR gets one entry with client
texts (pt/en), an hours estimate the user approves, and the Claude tokens spent on its branch.
The entries render into one shareable page per client. It must run on `git`, `gh` and Node
alone, with no hosted service or account.

## Why

Estimates written by the model without a breakdown reached a client page inflated about 6×,
mostly by counting a generated OpenAPI file. Token counts on reused branches kept growing after
the merge. The skill makes the estimate the user's call and bounds tokens by the merge.

## Phases

1. **Port**: the calendar, page renderer, token measurement from Claude Code transcripts,
   `gh pr create` target parsing and gh helpers, as zero-dependency ESM with ported tests.
2. **Store**: one JSON file per client (`~/.claude/releases/<slug>.json`). Entries are keyed by
   repo and PR number, because branches get reused. Saves are atomic and keep a `.bak`.
3. **Commands**: `init`, `measure` (lines by kind, generated excluded, plus tokens), `add`,
   `check`, `html`, `require` (hook), `import`, `audit` (report only).
4. **Skill + plugin**: SKILL.md flow (measure, propose, wait for yes, write), a PreToolUse hook,
   and a marketplace manifest.

## Acceptance criteria

- `npm test` passes, covering the ported suites plus store, gate, import and page.
- The gate exits 2 for `gh pr create` in a listed repo without an open entry, follows a
  `cd` before the command, and exits 0 for unlisted repos and other commands.
- A merged PR's tokens are measured only up to its merge. A failed measurement keeps the stored count.
- The page starts with `<!DOCTYPE html>` and is self-contained.
- `claude plugin validate .` passes.

## Code references

- `skills/release/scripts/release.mjs`: the commands
- `skills/release/scripts/lib/store.mjs`: client files and entry keys
- `skills/release/scripts/lib/lines.mjs`: what counts toward an estimate
- `skills/release/scripts/lib/usage.mjs`: tokens from `~/.claude/projects/**.jsonl`
