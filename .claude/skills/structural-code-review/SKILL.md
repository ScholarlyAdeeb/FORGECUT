---
name: structural-code-review
description: Review code changes, pull requests, branches, or implementation plans for structural maintainability. Use when the review should be strict about architecture, abstraction quality, module boundaries, repeated logic, large-file growth, special-case branching, type contracts, service/action ownership, spaghetti control flow, or code that works but makes the codebase harder to evolve.
---

# Structural Code Review

## Purpose

Use this skill to review code for structural quality rather than cosmetic cleanup. The goal is to preserve intended behavior while pushing the implementation toward fewer concepts, clearer boundaries, simpler control flow, and better long-term maintainability.

Prefer a small number of high-conviction structural findings over a long list of style nits.

## Review Workflow

1. Identify the intent of the change and the main files, modules, services, actions, and data boundaries it touches.
2. Compare the new shape against the surrounding architecture. Look for drift from existing ownership patterns and canonical helpers.
3. Ask whether the same behavior can be expressed with fewer branches, modes, wrappers, flags, or layers.
4. Separate true domain rules from reusable operational mechanics. Domain orchestration should stay near the product flow; shared mechanics should live behind explicit, composable helpers or services.
5. Check whether the change increases coupling, statefulness, file size, or reader burden.
6. Verify that proposed structural changes preserve behavior and can be migrated safely.

## Standards

### Simpler Model First

Look for a reframing that deletes complexity instead of merely relocating it. Favor designs that make the implementation feel obvious after the fact: fewer concepts, fewer exception paths, and fewer facts a reader must keep in mind.

### Boundaries And Ownership

Flag logic in the wrong layer. Feature-specific rules should not leak into general-purpose utilities, provider adapters, shared services, or low-level helpers. Shared mechanics should not mutate domain state or secretly own product policy.

### Branching And Special Cases

Treat scattered conditionals, ad-hoc flags, nullable modes, and repeated special cases as design signals. Prefer a clearer model, dispatcher, policy object, helper, or dedicated module when the current path is becoming harder to reason about.

### Abstractions Must Earn Their Keep

Reject wrappers, pass-through helpers, generic engines, and configuration systems that add indirection without reducing meaningful complexity. Prefer direct code when the abstraction does not clarify ownership, remove duplication, or protect a real boundary.

### Type And Contract Cleanliness

Question `any`, `unknown`, casts, unnecessary optional fields, silent fallbacks, and loosely shaped objects when they hide an invariant. Prefer explicit inputs, structured outputs, and typed boundaries that make invalid states harder to express.

### File And Module Size

Flag large-file growth when it makes the code harder to scan or when a change pushes a file toward or beyond roughly 1000 lines without a strong structural reason. Prefer focused modules, subcomponents, helpers, or services when they create real ownership boundaries.

### Orchestration And Atomicity

Flag sequential orchestration when independent work is serialized for no clear reason, especially if parallel structure would also be simpler. Flag partial-update flows when related state can be left half-applied and a more atomic structure is available.

## What To Flag

Escalate these as structural findings:

- A working implementation that makes the surrounding code more tangled.
- Repeated operational blocks copied across workflows.
- New conditionals inserted into unrelated or already busy flows.
- Feature checks scattered across shared code.
- A service or helper that reaches into database state it should not own.
- Domain policy hidden inside generic operational mechanics.
- A large function, file, component, or action that should be decomposed.
- Refactors that move complexity around without reducing it.
- Generic "magic" that obscures a simple data shape or lifecycle.
- Thin wrappers that rename an operation without clarifying anything.
- Cast-heavy or optionality-heavy code that masks a missing contract.
- Duplicate helpers where a canonical utility already exists.
- Edge-case handling embedded in the middle of a core flow.
- Temporary branches likely to become permanent debt.

## Preferred Remedies

When raising a finding, suggest a concrete cleaner direction:

- Delete an unnecessary layer or wrapper.
- Collapse duplicate branches into one clearer flow.
- Reframe the state model so repeated conditionals disappear.
- Move feature-specific logic behind a dedicated abstraction.
- Move shared mechanics into a service/helper with explicit parameters and structured returns.
- Keep auth, policy, status transitions, and user-facing failure classification in the orchestration layer.
- Split a large file into focused modules only when the split clarifies ownership.
- Replace condition chains with a typed model, explicit dispatcher, or policy map.
- Separate orchestration from business logic when they are tangled.
- Reuse the existing canonical helper instead of adding a near-duplicate.
- Make the boundary explicit instead of relying on casts, nullable values, or silent fallback behavior.
- Group related updates into an atomic operation when partial state would be hard to reason about.

## Output Expectations

Lead with findings ordered by structural impact. For each finding, include:

1. The affected file and line when available.
2. The structural problem.
3. Why it matters for maintainability.
4. A specific direction for a cleaner implementation.

Do not spend review attention on formatting, naming, or tiny local cleanups unless they are symptoms of a larger structural issue.

If there are no high-confidence structural issues, say so directly and mention any residual test or review risk.

## Approval Bar

Do not approve a change merely because it appears to work. Push back when there is a clear:

- structural regression in the touched area
- missed opportunity to dramatically simplify the implementation
- unjustified large-file or large-function growth
- spaghetti growth from special-case branching
- abstraction that adds indirection without simplifying ownership
- type boundary that hides the true invariant
- architecture boundary leak
- duplicate of an existing canonical helper
- decomposition opportunity that would materially reduce maintenance cost

Be direct and respectful. Major maintainability problems should sound like review blockers, not optional polish.
