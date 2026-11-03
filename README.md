# release

A Claude Code skill for agencies and freelancers who bill clients for work done with
Claude. Each PR gets one delivery entry with:
- what changed, written for the client (pt and en)
- the hours a senior developer would need, which **you** approve
- the Claude tokens spent on its branch, measured from the local session logs

The entries render into one page per client that you can share.

## Install

```
/plugin marketplace add piclez/release-skill
/plugin install release@release-skill
```

Needs `git`, `gh` (logged in) and Node 20+. No npm dependencies.

## Set up a client

```
node skills/release/scripts/release.mjs init --client "Acme" --repo acme/shop --product "Shop" --tz America/Sao_Paulo
```

One file per client in `~/.claude/releases/` (set `RELEASES_DIR` to move it). A client can
list several repos, and each repo is one product on the page. Every save keeps a `.bak` copy.

## What it does

- **Before `gh pr create`**: the hook blocks the PR in any repo a client lists until the
  branch has an entry. Claude measures the branch (code / tests / docs lines, with generated
  files excluded, plus tokens). Then it proposes the client texts and an hours breakdown,
  and waits for your number before saving.
- **After a merge**: `check` fixes the PR number, status and date. Tokens are counted up to
  the merge time only.
- **Page**: `html` renders one self-contained HTML page. With the claude-artifacts tools,
  Claude publishes it to the client's artifact and always reuses the same link.
- **Audit**: `audit` lists every entry's hours next to the lines it counted, so an estimate
  that's out of line stands out. It never changes anything.

Repos no client lists are never blocked. The page is in Portuguese (pt-BR) for now.

## Commands

```
release.mjs init | measure | add | check | html | require | import | audit
release.mjs help <command>
```

`import` also accepts the row format of frenti's `/api/deliveries`, for a one-time move.

## Test

```
npm test
```
