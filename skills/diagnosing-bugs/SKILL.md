---
name: diagnosing-bugs
description: Diagnose defects, regressions, unexpected failures, flaky behaviour, and performance problems through a reproducible feedback loop, minimized evidence, falsifiable hypotheses, and root-cause verification. Use independently for diagnosis or from implement for defect work. Fix only when the request authorizes implementation, and never commit or push automatically.
---

# Diagnosing bugs

Replace speculative patching with an evidence-driven diagnosis loop. First make
the reported symptom reproducible, then minimize it, distinguish causes, and
only then apply an authorized fix.

The user's wording controls the stopping point. A request to diagnose, explain,
or find the cause authorizes investigation but not a product fix. A request to
fix or implement the defect authorizes the smallest verified correction within
scope. Neither mode authorizes commits, pushes, deployments, production
instrumentation, remote data changes, or pull requests.

## Protect evidence and existing work

Read the issue or report, every supplied error and artifact, relevant comments,
the applicable context and ADRs from the reading order in
`docs/agents/domain.md`, repository status, recent changes when relevant, and
the affected component's commands in `docs/agents/verification.md`. Handle a
missing profile file, or a `TODO` or `None` value, as the
[project profile](../../references/project-profile.md) describes. Distinguish
observed facts from user or reviewer hypotheses.

If the failure involves a boundary between parts that ship or version
separately, follow `cross-boundary-contract`. Inspect the relevant producer and
consumer, keep changes and verification separate for every Git repository
involved, and preserve every compatible version combination when an authorized
fix is implemented.

Never expose secrets while showing commands, logs, requests, screenshots, crash
reports, save files, or captured traffic. Redact credentials, tokens, cookies,
authorization headers, private keys, and sensitive records as `<REDACTED>`.
Keep credentials in the environment rather than command text or committed
fixtures. Do not open or print the protected files listed in
`docs/agents/verification.md`, or any other secret-bearing file, merely to debug
configuration. When `docs/agents/verification.md` is missing, or its protected
files are still `TODO`, treat the files that the
[project profile](../../references/project-profile.md) lists as protected until
then.

Preserve unrelated working-tree changes. Temporary instrumentation and harnesses
must be uniquely identifiable and removable; do not hide debugging state in a
commit, stash, reset, or destructive cleanup.

## 1. Build a red-capable feedback loop

Choose the tightest available signal that exercises the actual failing path and
can distinguish failure from success. The platform guide for the affected
component, in [platforms](../../references/platforms/README.md), lists loops
that work there. Prefer, in roughly this order:

1. an existing or new focused test at the correct public seam;
2. a local API request, CLI command, or deterministic fixture invocation;
3. an existing browser, UI, or game automation harness;
4. a replay of a redacted request, payload, event sequence, input recording,
   save file, or trace;
5. a minimal throwaway harness around the affected subsystem;
6. a seeded stress, property, fuzz, differential, or bisection loop; or
7. precise human-in-the-loop steps when a physical device, console, hosted
   service, or inaccessible UI is genuinely required.

Run the loop at least once and record the exact command or manual sequence and
the symptom it captured. It must fail on the user's reported behaviour, not a
nearby setup error. Tighten it where practical: narrow setup, assert the exact
symptom, pin time, randomness, and timestep, isolate network and filesystem
state, and increase the reproduction rate of flaky failures.

For performance regressions, establish a repeatable baseline measurement or
profile before changing code, on the hardware the regression was reported on
when it matters. For nondeterministic bugs, improve the reproduction rate with
controlled repetition or concurrency rather than waiting for luck.

If no trustworthy loop can be built, stop and report what was attempted. Ask for
the missing environment, a redacted artifact, a user-run observation, or
explicit permission for scoped instrumentation. Do not substitute code reading
and confidence for reproducible evidence.

## 2. Reproduce and minimize

Confirm the loop reproduces the exact reported symptom across enough runs to be
credible. Capture the failure message, incorrect output, state transition,
timing, or network behaviour needed to compare the eventual fix.

Reduce the scenario one input, caller, dependency, configuration value, record,
or interaction at a time. Rerun after every reduction and retain only what is
load-bearing. The smallest faithful reproduction becomes the regression-test
candidate and sharply limits the hypothesis space.

Skip minimization only when the existing reproduction is already demonstrably
minimal or reducing it would remove the real system boundary. State that reason.

## 3. Form and test hypotheses

For a non-obvious failure, list a small ranked set of plausible causes. Each
hypothesis must predict an observation that would support or falsify it. Share
the ranking as a concise progress update so the user can contribute relevant
domain or deployment history, but continue with safe investigation unless a
decision is required.

When evidence uniquely identifies a simple cause, state the evidence and why
competing explanations are no longer plausible rather than inventing extra
hypotheses ceremonially.

Test one prediction and change one variable at a time. Prefer debugger or REPL
inspection, then targeted boundary instrumentation. Never add broad logging and
search it afterward. Tag temporary logs or probes with one unique marker so
their complete removal can be verified.

Record which evidence rejected each material alternative and which hypothesis
survived. Identify the root cause at the responsible boundary, not merely the
line where the symptom surfaced. For behaviour that crosses a boundary,
distinguish the producer, consumer, contract, and version combination involved,
such as an older installed client calling a newer server.

## 4. Stop or fix according to authorization

For diagnosis-only work, stop once the root cause and impact are supported by
evidence. Report the reproduction, cause, affected paths or boundary, confidence,
and a proposed fix and verification plan. Remove temporary instrumentation first.

When a fix is authorized:

1. Select a regression seam that reproduces the real call pattern. A shallow
   unit test is not sufficient when the bug requires a route, persistence rule,
   multiple callers, a background job cycle, a network round trip, a sequence
   of frames, or UI integration.
2. Invoke `tdd`: turn the minimized reproduction into a failing regression test
   and observe the expected red result before changing production behaviour.
3. Apply the smallest correction to the established root cause. Do not combine
   opportunistic refactors or unrelated cleanup with the fix.
4. Observe the regression test turn green, rerun related focused checks, then
   rerun the original unminimized feedback loop.
5. If no correct automated seam exists, record that architectural limitation and
   use the strongest available original-loop verification. Do not add a test
   that cannot actually catch the reported defect.

If an attempted fix fails, return to the hypothesis evidence. Do not stack a
second speculative fix on top of the first.

## 5. Clean up and report

Before declaring the diagnosis or authorized fix complete:

- rerun the original reproduction and record the result;
- run the regression and related checks, or explain why no correct seam exists;
- remove every tagged debug statement and temporary probe;
- delete throwaway artifacts unless the issue explicitly calls for a maintained
  diagnostic fixture, and verify they are absent from the diff;
- inspect the final diff for unrelated changes and sensitive data; and
- keep any useful permanent observability change only when it is in scope and
  verified independently from the temporary debugging output.

Report the observed symptom, minimized reproduction, root cause, rejected
hypotheses when useful, changed behaviour if a fix was authorized, exact checks,
remaining uncertainty, and practical verification. Link the issue and any
commit, pull request, or comment the report names, per the
[GitHub reference rules](../../references/github-references.md). State
explicitly whether the work stopped at diagnosis or included a local fix.

Do not commit, push, deploy, publish, open a pull request, or change issue status.
Return an authorized fix to `implement` for the remaining issue-level checks.
