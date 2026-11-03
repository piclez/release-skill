---
name: release
description: Keep a client's delivery log (one entry per PR, with an approved hours estimate and the Claude tokens spent) and publish it as a shareable page. Use before `gh pr create` in a repo that belongs to a client, after a PR merges, when the user says "release", "delivery entry", "entregas", "client page", "update the client page", "audit the hours", or asks for the link to share with a client, or when the release hook blocks a `gh pr create`.
argument-hint: "[add | check | page | audit | init] [client]"
---

# Release: the client delivery log

Every PR you do for a client gets one entry: what changed (in plain language, pt and en),
the hours a senior developer would need, and the Claude tokens spent on its branch. The
entries render into one page per client that you share with them.

`R` below means: `node "<this skill's base directory>/scripts/release.mjs"`.
It needs `git`, `gh` (logged in) and Node 20 or later. Data lives in
`~/.claude/releases/<client>.json` (or `$RELEASES_DIR`). Each save also keeps a `.bak` copy.

## Pick the mode

| The user says / the situation | Mode |
|---|---|
| hook blocked `gh pr create`, "add the release", "delivery entry" | `add` |
| PR just opened or merged, "update the status" | `check` |
| "update the client page", "link for the client", "entregas" | `page` |
| "audit the hours", "is this estimate right", an estimate looks off | `audit` |
| `add` says no client lists this repo | `init` |

## add: the estimate is the user's call, not yours

1. `R measure`. You get lines per kind (code / tests / docs / generated) and the branch's tokens.
2. Draft the entry and **show it before writing anything**:
   - Title and summary in pt and en. Write for the client: what they can do now that they
     couldn't before. No file names, no jargon, one short paragraph.
   - Hours, with a breakdown table: one row per piece of work, the hours for each, and
     which lines it covers. Count only code, tests and docs. Generated files (lockfiles,
     `openapi.json`, snapshots, migration SQL, build output) are work the tool did, so
     they add zero hours. Estimate what a senior developer would actually need, not the
     line count. A PR of a few hundred lines is usually a few hours.
3. Wait for the user's yes or their number. **Never pick the hours yourself.** An entry once
   went to the client at 40 h on a one-line guess. The user's number was 6 h.
4. `R add --estimate <h> --breakdown "<one line>" --title-pt "…" --title-en "…" --summary-pt "…" --summary-en "…"`
5. Then `gh pr create`. The hook lets it through once the entry exists.

Work done in another worktree is tagged with the branch of the checkout the session started
in. Pass `--measure-branch <tag> --since <iso> --until <iso>` to read the right slice.

## check

`R check` after `gh pr create` and after a merge. It fixes the PR number, status and date.
Once a PR is merged, its tokens are counted only up to the merge time, so later work on the
same branch doesn't inflate an entry the client has already seen. A measurement that finds
nothing keeps the stored count.

## page

1. `R html --client "<name>" --out .local/entregas-<client-slug>.html` (default
   `~/.claude/releases/<slug>.html`). Never write it under `/tmp`, because macOS deletes it.
2. If the claude-artifacts tools are available:
   - If the client file has `artifact.slug`: run `get_artifact` first (for `base_version` and
     the `read` value), then `publish_files` to **that same slug**. Never create a new artifact
     for a client that already has one, because the client's link would stop updating.
   - With no slug yet: publish a new one, then save it with `R init --client "<name>" --artifact <slug>`.
   - If `read` is `owner`, tell the user the client can't open it yet. They share it from the
     page on claude.ai. You can't change sharing.
3. Without those tools, `open` the HTML file and say where it is.
4. `open` the page URL, and give the user the link.

## audit

`R audit --client "<name>"` lists every entry with its hours next to the lines it counted,
lowest lines per hour first. It changes nothing. Show the table, point out the outliers,
and correct an entry only with the user's number (`R add --branch <b> --estimate <h>`, run
in that repo).

## init

`R init --client "<name>" --repo <owner/repo> --product "<product name>" --tz <IANA zone>`.
One client can list several repos, and each repo is one product on the page.

## The hook

The plugin's PreToolUse hook runs `R require` on every Bash call. It only acts on
`gh pr create`, and only in a repo that some client file lists. A repo no client lists is
never blocked.
