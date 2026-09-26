---
name: align-issue
description: Resolve material user-owned decisions before creating an issue or starting its implementation plan. Use from create-issue or start-issue when unresolved choices would change the outcome, scope, observable behaviour, acceptance criteria, compatibility, decomposition, or first executable slice, and whenever the user asks to grill or stress-test an issue or plan. Do not use for facts the agent can inspect or routine implementation choices.
---

# Align issue

Reach a shared understanding of an issue or implementation plan before the
calling workflow changes GitHub or local branch state. Ask questions and return
a confirmed alignment record. Do not create or edit issues, create branches,
change assignments or project fields, or implement the work.

## Enter only for material decisions

Run this interview when the user explicitly asks to be grilled, interviewed,
or challenged about an issue or plan. Also run it when `create-issue` or
`start-issue` finds an unresolved user-owned decision that could change:

- the intended outcome, affected user or player, or problem boundary;
- observable behaviour, acceptance criteria, or explicit non-goals;
- a product, pricing, game-design, policy, privacy, security, safety,
  data-loss, or recovery trade-off;
- a boundary contract, migration, save or data format, compatibility, rollout,
  or rollback requirement;
- issue decomposition, implementation order, or the first executable slice.

Do not manufacture questions to make the interview look thorough. Do not ask
the user for repository facts, current behaviour, existing conventions, or
other information available through inspection. Resolve those facts first.
Leave routine implementation choices to the implementing workflow when they do
not change product behaviour, compatibility, risk, or scope. A detail may stay
unknown when the calling workflow can label it honestly without making the
issue misleading or unactionable.

## Build the decision tree

Start with the intended outcome. Organize every material open decision under
the decision it depends on. Keep the tree internal unless showing it would help
the user understand the choices.

Separate the available context into four groups:

- verified or user-reported facts;
- settled user decisions;
- open decisions that belong to the user;
- technical choices that the agent can make within the settled constraints.

A user decision belongs in the tree only when reasonable answers lead to
meaningfully different issues or plans. If a question depends on an unanswered
parent decision, keep it out of the current round.

## Work through dependency-ready questions

The frontier is the set of open decisions whose prerequisites are settled. Ask
the current frontier in one round so the user can answer independent questions
together. Consolidate duplicate or tightly coupled choices. If the frontier is
too large for a coherent response, split it by branch and say which branches
remain.

Number each question. Use this structure:

```markdown
1. Decision title

   Question: State the choice and enough context to answer it.

   Recommendation: Give the preferred answer and the trade-off that supports it.
```

Offer options when they clarify a real choice, but do not force an artificial
multiple-choice answer. Recommend one answer whenever the evidence supports a
preference. The decision remains the user's.

After each reply:

1. Record the answers without changing their meaning.
2. Identify and resolve contradictions with earlier decisions.
3. Recompute the tree and its frontier.
4. Ask the next dependency-ready round, then wait again.

Do not repeat settled questions. If new evidence overturns a settled premise,
explain the evidence and reopen only the decisions it affects.

## Confirm shared understanding

The interview is complete when every material decision is settled, recorded as
an explicit non-goal, or deliberately deferred with an owner and a condition
for revisiting it. No unresolved decision may block truthful issue creation or
the first executable implementation slice.

Present an alignment record containing:

- the intended outcome and affected user or system;
- the decisions and the reasons that matter;
- observable acceptance criteria implied by those decisions;
- explicit non-goals;
- deferred decisions, each with its owner and revisit condition;
- effects on compatibility, decomposition, rollout, or implementation order.

Ask the user to confirm or correct the record. Do not report shared alignment
to the calling workflow until the user confirms it. The user may direct the
workflow to proceed with a named unresolved decision. Record that direction,
then let the calling workflow decide whether its safety and authorization rules
permit the next action.

Return the confirmed alignment record to `create-issue` or `start-issue`. The
calling skill incorporates it into the issue or working specification and owns
every later mutation.

This workflow adapts the dependency-ordered interview pattern from Mat
Pocock's [grilling skill](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md).
