# Setup — detect & install the workflow's tools

Run this once per machine (and per project, if installing project-local). Claude
Code **detects** what's present, **offers** what's missing, and installs **only
after you confirm**. Nothing is installed silently.

This setup path is for Claude Code. It assumes Claude Code is the main agent,
with native `/simplify` and `/verify`, installable Claude Code skills, and the
Codex plugin for `/codex:review`.

## 1. Probe (read-only)

```bash
bash <skill-dir>/scripts/check-deps.sh
```

It prints `[OK]` / `[MISSING]` per dependency and makes no changes. Also treat any
`/codex:*` or skill commands already listed as available in the session as present —
that's the most reliable signal for plugin-provided tools.

## 2. Ask where to install

Before installing any copyable skill, ask the user: **global or project?**

- **Global** → `~/.claude/skills/<name>/SKILL.md` — available in every project.
- **Project** → `./.claude/skills/<name>/SKILL.md` — committed/shared with this repo.

Ask once and reuse the answer for the run unless told otherwise.

## 3. Dependency manifest

Each installable skill is a single `SKILL.md`. **Install order: prefer a local
sibling directory** (next to this skill — fast, offline, no fetch), **else fetch the
source URL.** URLs track `main`.

| Name | Powers | Source URL (fallback to sibling dir) | Detect at |
|------|--------|--------------------------------------|-----------|
| `grill-with-docs` | Pre-flight | `https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/grill-with-docs/SKILL.md` | `*/.claude/skills/grill-with-docs/SKILL.md` |
| `structural-code-review` | Structure review | `https://raw.githubusercontent.com/mstfash/skills/main/structural-code-review/SKILL.md` | `*/.claude/skills/structural-code-review/SKILL.md` |
| `frontend-visual-qa` | Runtime smoke (UI) | `https://raw.githubusercontent.com/mstfash/skills/main/frontend-visual-qa/SKILL.md` | `*/.claude/skills/frontend-visual-qa/SKILL.md` |
| Codex plugin (`/codex:review`) | Independent review | `openai/codex-plugin-cc` — **you** run `/plugin` (see §5) | `~/.claude/plugins/` or `/codex:*` available |
| `/simplify`, `/verify` | Simplify, Verify | native — built in | always present |

## 4. Install — copyable skills (Claude Code does this, on confirm)

For each **missing** skill the user approves:

1. **Get the `SKILL.md`** (these three are single-file):
   - **Prefer a local sibling** — `<skill-dir>/../<name>/SKILL.md`. If ship-loop
     was installed from the `mstfash/skills` repo, the siblings are right there;
     copy the folder (no network).
   - **Else fetch the source URL** from the manifest (§3).
2. **Review before trusting.** Read the fetched/copied `SKILL.md` — confirm it does
   what it claims and asks nothing dangerous of Claude Code — before installing. Never
   install a skill you haven't read.
3. **Write** it to the chosen location, preserving the folder name:
   `<global-or-project>/.claude/skills/<name>/SKILL.md`.
4. **Verify** the file exists and re-probe.

## 5. Install — Codex plugin (you run these; Claude Code cannot)

`/plugin` commands are interactive and only run from your prompt. If the probe shows
the Codex plugin missing, Claude Code should hand you exactly this and stop:

```text
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/reload-plugins
/codex:setup
```

`/codex:setup` checks the local Codex CLI is ready. Until this is done,
INDEPENDENT REVIEW falls back to another model/agent/person.

## 6. Report

Summarize: what was already present, what was installed and where, what the user
still needs to run (the `/plugin` block), and which stages will use a manual
fallback because their tool was declined or unavailable.

## 7. When a tool is missing at runtime

A missing tool **downgrades automation; it never removes a gate layer.** No stage is
ever silently skipped because its tool isn't there. When you reach a stage whose tool
is absent:

1. **Offer to install it** (copyable skills) or hand over the `/plugin` block (Codex)
   — once. If the user installs it, use it.
2. **If it's declined, fails to install, or can't be installed mid-run:** run the
   stage's **manual fallback** from `phase-checklist.md`, and **say so out loud** —
   e.g. "structure review run manually; `structural-code-review` not installed." A
   downgraded stage must be visible, not silent.

Concrete cases:

- **`structural-code-review` not found** → STRUCTURE REVIEW still runs: work through
  the checklist in `phase-checklist.md §3` by hand (boundaries, duplication,
  oversized files/functions, abstractions that don't pay for themselves, leaking
  domain rules). Report it as a manual structural pass.
- **`/codex:review` / Codex plugin not found** → INDEPENDENT REVIEW still runs, but
  it must stay *independent*: get the second pass from another model or a separate
  review agent (or a person). If no independent reviewer is available at all, do an
  explicit adversarial self-review **and record "independent review unavailable" as a
  residual risk in the report** — never let a self-review silently stand in for it.
  Offer the `/plugin` install so the next run is covered.
- **`grill-with-docs` not found** → PRE-FLIGHT still runs: grill the plan by hand
  against the project's docs, schemas, and ADRs.
- **`frontend-visual-qa` not found** → RUNTIME SMOKE still runs: boot the app and do
  the desktop + mobile browser checks manually.

Native `/simplify` and `/verify` are always present, so SIMPLIFY and VERIFY never
fall back.

The rule of thumb: **the gate's coverage is fixed; only how much of it is automated
varies.** If a layer's tool is missing, you do that layer yourself and flag it —
especially independent review, which can't be fully self-substituted.
