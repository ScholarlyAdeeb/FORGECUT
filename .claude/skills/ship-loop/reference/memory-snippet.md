# Make the workflow always run — memory snippet

Skills are **model-invoked** (Claude reads the description and decides), so the skill
alone does not guarantee the cadence. To make the agent reliably **plan + grill
first, then gate every phase**, add an always-loaded rule to a memory file. Claude
Code auto-loads `CLAUDE.md`; it does **not** auto-load `AGENTS.md`.

## The rule to paste

```markdown
## Implementation workflow (always)

For any non-trivial implementation — a feature, phase, or milestone — use the
`ship-loop` skill and follow its cadence; do not improvise an ad-hoc process.

- **Frame before coding (once):** plan and slice the work into phases, then grill the
  plan with `grill-with-docs` before committing to an approach. For UI work, design
  the system first.
- **Gate every phase:** a phase is done only when the completion gate is green —
  verify → simplify → independent review → structure review → runtime smoke → commit.
  Run it at the END OF EACH PHASE, not once at the end of the whole effort.
- **Do not self-certify.** Passing tests plus a self-review is not proof of
  correctness — run the independent layers; record any explicitly deferred findings.
- **Scale rigor to risk:** a one-line change doesn't need the full gate; a data-driven
  or user-facing change does.
```

## Where to put it

Pick the scope that matches how widely you want it enforced:

| Want it… | Put the rule in | Notes |
|----------|-----------------|-------|
| In **one project** (Claude Code only) | `./CLAUDE.md` (or `./.claude/CLAUDE.md`) | Auto-loaded, source-controlled, team-shared. |
| In **one project**, shared with **Codex** | `./AGENTS.md` **+** add `@AGENTS.md` to `./CLAUDE.md` | Codex reads `AGENTS.md` natively; the import makes Claude Code read the same file. One source, no duplication. |
| In **every project** (just you) | `~/.claude/CLAUDE.md` | Global. Use if you want this to be your default everywhere. |

### Codex + Claude Code, one source of truth

Keep the rule in `AGENTS.md` and make `CLAUDE.md` import it:

```markdown
# CLAUDE.md
@AGENTS.md
```

Now both tools read the same instruction. (`@import` resolves relative to the
importing file; first use prompts an approval dialog.)

## Stronger enforcement (optional)

The memory rule is guidance — strong, but Claude can still deviate. If you want a
**deterministic** nudge, add a `Stop` hook that reminds the agent to confirm the gate
ran before ending a turn. It can't verify the gate truly executed, and it fires on
every stop (noisy), so prefer the memory rule unless you specifically need the hard
gate. See `code.claude.com/docs/en/hooks`.
