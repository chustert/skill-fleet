---
name: implement-slice
description: Implement one small slice from a started GitHub issue's ordered plan, verify it, explain what changed and why, and list every file touched. Use when the user requests implementation in small chunks with developer review between them. Wait for the user's continue before the next slice. Always apply unslop. Use implement for continuous implementation and teach for read-only tutoring.
---

# Implement slice

Implement one small, reviewable chunk of the issue, then return control to the
developer. The developer reviews the actual changes before asking for the next
chunk. Invoking this skill authorizes the first slice's local implementation and
verification. Each subsequent `continue` authorizes one more slice.

Read [implement](../implement/SKILL.md) and use its preflight, implementation
discipline, per-step diff inspection, verification, and authorization boundaries.
This skill replaces its automatic progression and per-turn handoff with the
pacing and report below. Run its final verification only after the last slice.
Keep its requirement to name `verify-work` as the manual next step rather than
invoking it automatically.

Use the one-stage-at-a-time pacing of [teach](../teach/SKILL.md). Implement the
changes yourself under `implement`'s rules, and explain them with its step
explanation and response style. Do not invoke `teach` or adopt its read-only
restrictions or placeholder-first sequence.

Read and apply [unslop](../unslop/SKILL.md) to every response, including progress
updates and review reports. Apply it to any prose artifacts changed by the slice.

## Select one slice

1. Read the `start-issue` handoff and complete ordered slice plan. Check the plan
   against the current issue, specification, branch, and working tree using
   `implement`'s preflight. Preserve its recorded quality and contract decisions.
2. Select the first pending slice whose dependencies are complete, or the slice
   the user explicitly selects when its prerequisites are satisfied. Carry
   completed slices forward. Do not restart them after a context reset.
3. If an older handoff has no slice plan, establish the complete plan using
   [start-issue's planning requirements](../start-issue/SKILL.md) before editing.
   This planning repair does not restart branches or synchronize GitHub metadata.
   Use `implement`'s preflight stop when the issue itself has not been safely started.
4. If the selected slice contains several independently reviewable outcomes,
   subdivide it in the working plan before editing. Preserve the parent slice ID
   in the new identifiers and retain the remaining work in order. State the
   revised boundaries and implement only the first resulting slice.
5. Briefly state the slice ID, intended outcome, and verification. Proceed with
   this slice without another permission question when its scope is clear.

Treat one slice as one outcome the developer can understand from a focused diff
and short explanation. Keep necessary code and tests together. A slice may touch
several layers or files, but must not absorb unrelated cleanup or later outcomes.
Pause for a scope or product decision when the existing authorization cannot
resolve it.

## Implement and verify this slice

Follow `implement`'s discipline routing, including `tdd` for observable behaviour,
`diagnosing-bugs` for defects, and proportionate checks for non-executable changes.
Complete the current slice's focused verification before the review checkpoint.
Fix failures attributable to this slice within its scope. If verification is
blocked, report the evidence and prerequisite, and keep the slice incomplete.

Capture the current slice's starting diff so its changes can be separated from
earlier slices and user edits. Inspect the resulting diff and inventory every
file this slice created, modified, deleted, or renamed, including tests,
documentation, generated files, assets, and plan files. For a rename, record
both paths. Preserve unrelated work and avoid including it in the slice report.

Update the active working plan or handoff with the slice's status, check results,
and next pending slice. Do not update GitHub issue content or state. Keep enough
progress context to resume after an interruption without repeating completed work.

## Return a review report and stop

Return a self-contained report that explains the slice using
[implement's step explanation](../implement/SKILL.md#explain-each-step), with
the slice as the step:

- Open with the slice ID and title. For the first slice in a session, or when
  the plan changed, first state what is being built and list the ordered slices
  with a short reason for the order. Otherwise do not repeat the plan.
- Cover Goal, Why now, Location, Code, Explanation, Temporary or final,
  Checkpoint, and Next replacement as `implement` defines them.
- In Location, list every file this slice created, modified, deleted, or
  renamed as a clickable path with a one-line description. Group by component
  or repository when necessary and show both paths for a rename.
- In Checkpoint, give the exact verification commands and results, any skipped
  check or blocker, and what the developer should inspect. Then give the manual
  test steps for this slice with expected results and failure symptoms, as
  `implement` defines them, so the developer can try the slice before saying
  `continue`.
- Close with the next pending slice's ID and outcome.

Follow `implement`'s response style. Keep the explanation tight enough to
review alongside the code, and do not dump entire files. Link GitHub references
as the [GitHub reference rules](../../references/github-references.md) require.

End the turn after this report. When this slice is complete and more slices
remain, end with `Say "continue" to implement the next slice.` If the current
slice is blocked, state what is needed to resume it instead.
This checkpoint is the user's requested pacing.
Do not start later slices, run background implementation, or treat silence as
permission to proceed.

On `continue` or an equivalent request to proceed, check the current working tree
against the last checkpoint before selecting the next slice. Preserve edits the
developer made during review. If the current slice is incomplete, finish or
resolve that slice first and report it before advancing. Answer a question about
the completed slice without advancing. Apply requested revisions to that slice,
verify them, and return another review report before starting the next slice.

After the final slice, run `implement`'s complete local verification and return
its handoff, including the end-to-end flow, manual checks with expected results
and failure symptoms, edge cases and follow-ups, and the summary of engineering
decisions. Report overall completion or outstanding criteria. Name
`verify-work` as the manual next step. Do not request `continue` when no
implementation slices remain.
Keep changes local and uncommitted unless the user separately authorizes an
external action. A request to continue grants no commit, push, deployment,
publication, pull-request, or issue-mutation permission.
