---
name: ship-loop
description: "Claude Code shipping loop: enumerate the problem space and grill the plan, design the system (for UI work), implement, then run a definition-of-done gate (verify → simplify → independent review → structure review → runtime smoke → commit) before calling work complete. On first use it detects and offers to install the Claude Code tools each stage needs — the Codex review plugin, grill-with-docs, structural-code-review, frontend-visual-qa. Use when starting or finishing a meaningful unit of implementation work: a phase, feature slice, or milestone."
---

# Ship Loop

## Purpose

A repeatable loop for shipping a unit of work correctly, not just plausibly. It
front-loads thinking (enumerate the problem space, grill the plan), separates
design from implementation, and ends with a **definition-of-done gate** where
each layer catches a class of failure the cheaper layers miss.

The gate is not optional polish. Passing tests and a self-review is not proof the
work is correct — the author shares their own blind spots. Do not self-certify;
run the gate.

## First use in a Claude Code environment: set up tools

The stages below are designed for Claude Code as the main agent. `/simplify` and
`/verify` are native Claude Code skills; the other stages use installable Claude
Code skills or the Codex plugin. **On the first run in a new machine or project,
follow [`reference/setup.md`](reference/setup.md)** to detect what's present and
install what's missing.

What it bootstraps (it detects each, then installs only with your confirmation):

| Tool | Powers stage | Install |
|------|--------------|---------|
| `grill-with-docs` | Pre-flight (grill the plan) | fetch + copy a `SKILL.md` |
| `structural-code-review` | Structure review | copy a `SKILL.md` |
| `frontend-visual-qa` | Runtime smoke (UI work) | copy a `SKILL.md` |
| Codex plugin (`/codex:review`) | Independent review | **you** run `/plugin` commands |
| `/simplify`, `/verify` | Simplify, Verify | Claude Code native — nothing to install |

Before installing any fetched or copied skill, read its `SKILL.md` and confirm it
does what it claims without asking Claude Code to do anything unsafe. Claude Code
can install copyable skills itself after approval; it **cannot** install the Codex
plugin (that needs interactive `/plugin` commands only you can run) — setup will
hand you the exact commands. Run the read-only probe first:

```bash
bash <skill-dir>/scripts/check-deps.sh
```

Missing pieces **downgrade automation; they never remove a gate layer.** If a tool
isn't installed, that stage runs by hand against `phase-checklist.md` and Claude
Code says so — no stage is silently skipped. Independent review is the one
exception that can't be self-substituted: if no independent reviewer (Codex or
another model/agent) is available, it's done as an explicit adversarial pass and
flagged as a residual risk. See [`reference/setup.md`](reference/setup.md) §7 for
the exact behavior.

## Make It Run Every Time

This skill is **model-invoked** — Claude Code reads its description and decides
whether to load it. That makes the workflow *available*, not *guaranteed*. To
make Claude Code reliably frame-first and gate every phase, add an always-loaded
rule to a memory file. `CLAUDE.md` is auto-loaded; `AGENTS.md` is not, but Codex
reads it — import it from `CLAUDE.md` with `@AGENTS.md` to share one source.

Paste the rule from [`reference/memory-snippet.md`](reference/memory-snippet.md)
into the project's `CLAUDE.md`/`AGENTS.md` or `~/.claude/CLAUDE.md` for every
Claude Code project. The memory rule guarantees the workflow is invoked; the
skill supplies the detail. For hard enforcement, the snippet also covers an
optional Claude Code `Stop` hook.

## How It Runs

Two parts: a **one-time framing pass** up front, then a **per-phase loop**. The
completion gate fires at the end of **every phase** — not once at the very end. The
shape is:

```
FRAME ONCE:   plan + slice into phases  →  grill the plan  →  (UI) design the system
THEN, PER PHASE (repeat):   pre-flight  →  implement  →  GATE → green  →  commit  →  next phase
```

### Up front — frame the work (once per effort)

Do this before any phase starts, and only redo it if the plan materially changes:

1. **Plan and slice.** Break the effort into phases / feature slices small enough
   that each one can pass the gate on its own.
2. **Grill the plan.** Pressure-test the approach against the project's own docs and
   domain language with `grill-with-docs` — terminology, invariants, documented
   decisions — before committing to an approach.
3. **Design the system (UI work only).** Separate design-system creation from page
   implementation so screens come from a shared visual language, not improvised one
   at a time: collect references → generate tokens/components → refine until
   approved → share into the project → build pages from the system. Do this once;
   individual pages are then built phase by phase. Skip entirely for non-UI work.

### Per phase — repeat until the effort is done

For each phase from the plan:

1. **Pre-flight that phase.** Map the problem space for *this* phase so review rounds
   don't discover missing cases one at a time. Pick the artifacts that fit (decision
   table, state-machine table, field/input inventory, invariant list) and write
   **adversarial test stubs** for the empty, malformed, duplicate, boundary,
   authorization, tenancy, idempotency, concurrency, and partial-failure cases. If a
   surface is multi-axis, split enumeration across agents and merge their findings.
   Re-grill with `grill-with-docs` if the phase introduces new domain decisions.
2. **Implement.** Build against the pre-flight checklist (and the approved design
   system for UI). Run mechanical checks (VERIFY) after every meaningful change —
   never let the implementation drift while lint/typecheck/tests are red.
3. **Run the completion gate to green.** Before calling the phase done, run the full
   gate in [`reference/phase-checklist.md`](reference/phase-checklist.md):

   ```
   VERIFY → SIMPLIFY → INDEPENDENT REVIEW → STRUCTURE REVIEW → RUNTIME SMOKE → COMMIT HYGIENE
   ```

   Read that file **at the moment of use** — don't work from memory — and follow
   every step in order, including the loops back to Implement on failure.
4. **Commit, then start the next phase.** A clean gate + commit closes the phase; the
   next phase begins again at Pre-flight.

## When To Use

- Starting a non-trivial implementation: run Pre-flight (and Design for UI) first.
- Finishing a phase, feature slice, milestone, or implementation batch: run the
  completion gate before reporting done.
- Setting up a new machine or project: run setup once so the stages are tooled.

For a one-line copy edit or a throwaway spike, this is overkill — scale the rigor to
the risk. When in doubt, run more of the gate, and state what you scoped and why.
