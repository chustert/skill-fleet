---
name: implement
description: Implement an existing GitHub issue or approved issue-linked specification in small vertical steps, showing each relevant diff and running focused verification as work progresses. Use for authorized feature, fix, refactor, test, documentation, or configuration implementation. Route behavioural work through tdd and defects through diagnosing-bugs. Never commit, push, deploy, publish, open a pull request, or change issue state without separate authorization.
---

# Implement

Turn a started GitHub issue into verified local changes, one reviewable vertical
step at a time. The issue, its comments, and any explicitly approved
issue-linked specification remain authoritative.

Invoking this skill authorizes local edits within the implementation scope and
ordinary non-destructive verification. It does not authorize commits, pushes,
deployment, publication, remote database changes, pull-request creation, issue
edits, or destructive Git operations.

## Preflight the work

Before editing:

1. Resolve the exact issue and read its current body, acceptance criteria,
   relevant comments, relationships, and approved linked specification. Treat a
   local plan as supporting context, not as authority over newer issue decisions.
   Carry forward the quality decisions the `start-issue` handoff or specification
   recorded against the
   [software quality characteristics](../../references/software-quality-characteristics.md).
   If none were recorded, screen the work against that file, starting from the
   `Quality weighting` in `docs/agents/domain.md`, before the first step and
   state the handful of characteristics that carry material risk here.
2. Read the documents in the reading order of `docs/agents/domain.md`, any ADRs
   governing the area, and the verification settings in
   `docs/agents/verification.md` for every affected component. In a workspace
   of independent repositories, also read each affected repository's own
   `AGENTS.md`.
3. Confirm the implementation repository, current branch, expected issue number,
   base ref and commit, remote, worktree status, and diff from the recorded base.
   A branch description or prior `start-issue` handoff can supply the start
   record, but verify it against Git rather than trusting prose alone.
4. Inventory the initial worktree diff and distinguish issue-related work from
   pre-existing user changes. Clearly separable, non-overlapping changes may
   remain untouched; record them as the baseline and compare every implementation
   step against it so they are excluded from step diffs. Never reset, clean,
   stash, overwrite, or silently claim those changes. Stop when ownership,
   overlap, or attribution is ambiguous or prevents a trustworthy diff.
5. If the issue has not been safely started, its repository or branch is
   ambiguous, or a required specification decision is unresolved, stop and use
   `start-issue` or ask for the missing decision before changing product code.
6. Run the narrowest useful baseline check when it is inexpensive. Record any
   pre-existing failure separately so it is not attributed to this work.

For a boundary between parts that ship or version separately, follow
`cross-boundary-contract` before implementation. Preserve compatibility with
the versions on the other side that can meet this change, order the steps so
each intermediate state is safe to ship, and keep branches, diffs, checks,
commits, and eventual pull requests separate for each Git repository.

## Select the implementation discipline

- For new or changed observable behaviour, invoke `tdd` before changing the
  production behaviour. Use the test seams established by `start-issue`; if a
  seam is missing, identify it before writing the test. For a component without
  a test runner, follow `tdd`'s fallback rather than skipping the evidence.
- For a reported defect, regression, unexpected failure, or performance issue,
  invoke `diagnosing-bugs`. Do not start with a speculative fix. When a fix is
  authorized and a correct seam exists, lock the cause down with a failing
  regression test through `tdd` before applying the fix.
- For documentation, formatting, generated metadata, build configuration,
  content data, or another change without executable behaviour, use the
  smallest relevant validation. Do not fabricate a test merely to claim TDD.

These disciplines complement each other: diagnosis establishes the cause and a
red-capable reproduction; TDD turns an authorized behavioural change into a
durable red-to-green contract.

## Build one vertical step at a time

Derive the smallest ordered steps that satisfy the issue. Each step should
deliver one observable behaviour or independently verifiable outcome through
all layers it needs. Do not batch horizontal layers such as all models, then all
services, then all UI when a thin end-to-end slice can prove the design earlier.
The visible-first order in the component's platform guide, in
[platforms](../../references/platforms/README.md), is a good default for
user-facing work.

Before the first step, state what you are building: the user-visible behaviour,
any assumptions or open decisions, and the existing files, functions, and
patterns the work builds on. List the ordered steps with a short reason for the
order, and name any prerequisite that has to come first, such as a schema,
permission rule, save-format version, or contract.

For each step:

1. State the behaviour or outcome, the relevant seam, and the evidence that
   will mean the step is done.
2. Apply `tdd` or `diagnosing-bugs` when routed above, then make only the edits
   needed for this step. Do not anticipate later slices or widen the issue.
3. Inspect the step's diff separately from older branch work. Check for scope
   drift, accidental generated files, secret exposure, unsafe defaults, missing
   failure handling, and unrelated formatting churn.
4. Hold the step to the quality decisions recorded for this work. Implement the
   failure, permission, offline, limit, and compatibility behaviour the plan
   named alongside the success path rather than deferring it to a later slice,
   keep the change inside the module the plan gave it, and follow the recorded
   compatibility and rollout decision at any shared boundary. Do not add
   speculative configurability, abstraction, or optimisation to satisfy a
   characteristic the plan did not raise. When a step exposes a quality risk the
   plan missed, say so and either handle it in scope or record it as a follow-up;
   do not absorb it silently.
5. Run the narrowest focused check that proves the step, using the focused-test
   command in `docs/agents/verification.md` where one exists. Record the exact
   command and result. A focused test may run first for fast feedback; retain
   broader verification for the completion gate.
6. If the check fails, preserve the evidence and diagnose the failure. Change
   one cause at a time, show the revised diff, and rerun the focused check. Do
   not pile speculative patches onto an unexplained failure.
7. Record the step as complete in the active working plan or handoff, not by
   editing the GitHub issue unless the user separately authorizes that mutation.
8. Explain the step as described in [Explain each step](#explain-each-step).

After each meaningful step, send that explanation as the progress update.
Continue without a ceremonial approval gate unless the user requested
step-by-step approval. Pause when a step reveals a product decision, contract
change, unsafe action, scope expansion, substantial reviewability problem, or
conflict with the authoritative issue.

If a step becomes too large for a human to review, split it before continuing.
If the overall issue is larger than the approved decomposition, return to
`start-issue` rather than silently creating a large pull-request-shaped diff.

### Explain each step

The explanation should help the developer understand the change, not just see
that it exists. Cover:

1. **Goal**: the behaviour or outcome this step delivers.
2. **Why now**: why the step comes at this point in the order, including what
   it depends on and what it unblocks.
3. **Location**: each changed file as a clickable path, with the function,
   component, or section that changed.
4. **Code**: the relevant diff for this step only, not entire files. Use concise
   hunks, or a precise file-by-file summary when the raw patch would be noisy.
   Redact credentials and sensitive captured data.
5. **Explanation**: how the code works in plain language, what a caller, user,
   or player can now observe, and how it connects to earlier steps.
6. **Temporary or final**: whether the code is intended production code or
   scaffolding, such as a stub, fixture, placeholder asset, or flag, that a
   later step changes.
7. **Checkpoint**: the exact focused check and its result, what the developer
   should inspect in the diff, and how to test the step by hand before the next
   one. Give concrete actions the developer can run, such as a command, a
   request, a screen and the taps or clicks, a scene and the inputs, or a query.
   Include the expected result and what a failure would look like. When the
   step changes nothing a person can observe, say so and name the test that
   covers it instead.
8. **Next replacement**: for temporary code, the later step that replaces it and
   what changes then. Leave this out when the step leaves no temporary code.

Keep it tight enough to read alongside the diff.

## Complete local verification

After all vertical steps:

1. Re-read the issue and demonstrate how the diff satisfies each acceptance
   criterion and preserves every stated non-goal.
2. Run the final verification recorded in `docs/agents/verification.md` for
   every affected component, plus the runtime evidence its platform guide and
   the criteria call for, such as a browser, simulator, play-test, request, or
   local database check, when available and proportionate. Report unavailable
   prerequisites honestly.
3. When several components or repositories changed, verify and report each
   independently, then run the smallest end-to-end check across their boundary
   that the local environment supports.
4. Inspect the complete diff against the recorded base, the final worktree
   status, and whitespace or formatting checks. Confirm unrelated changes remain
   excluded.
5. Do not turn a passing local result into a commit or remote mutation. Leave
   the reviewed working tree intact for explicit user approval and the later
   approved pull-request preparation workflow.

## Response style

Apply [unslop](../unslop/SKILL.md) to every progress update and handoff.

- Keep it tight, not terse. Cut padding, but keep the detail that makes the
  mechanism understandable.
- Use headings and numbered steps.
- Explain the reasoning behind each choice, not only the result. When several
  approaches were valid, name the one chosen and the trade-off.
- Trace the concrete mechanism through real files, functions, types, and lines.
  A list of names is not an explanation.
- State assumptions and uncertainty. Separate what a check proved at runtime
  from what inspection suggests.
- Separate required work from optional improvements, and scaffolding from
  production code.
- Do not use stock framing such as "the key insight" or "at its core". End on
  the next concrete checkpoint rather than a summary slogan.

## Handoff

Return a compact implementation record containing:

- issue and approved specification references, linked per the
  [GitHub reference rules](../../references/github-references.md);
- affected components and repositories, branch, recorded base, and current
  worktree state;
- completed vertical steps and their resulting behaviour;
- changed files or areas and the relevant diff for the final step;
- how the complete flow works, traced from the user's action or the entry point
  through each layer and back to the observable result. When three or more
  parts interact, a short diagram can help;
- exact focused and final checks, with pass, fail, or not-run status;
- manual checks the developer can run themselves, with expected results and
  common failure symptoms;
- compatibility and rollout notes for boundary changes;
- important edge cases and follow-up improvements, with required work kept
  separate from optional improvements;
- known limitations, remaining risks, skipped checks, missing harnesses, and
  prerequisites;
- any acceptance criterion not yet proven;
- a concise summary of the engineering decisions the implementation made and
  why, including the planned quality decisions it honoured and any quality risk
  a step exposed that the plan had not raised; and
- the explicit statement that nothing was committed, pushed, deployed, or
  submitted as a pull request.

The implementation is not considered ready for PR preparation until
`verify-work` has completed. Do not invoke `verify-work` from this skill; name it
as the manual next step and stop.

Stop with the local implementation ready for review. Never automatically
commit—not even a checkpoint—and never push, merge, delete the branch, deploy,
publish, create a pull request, or move the issue to the in-review status.
