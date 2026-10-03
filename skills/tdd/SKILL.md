---
name: tdd
description: Implement observable behaviour test-first through small red-to-green vertical slices at stable public seams. Use independently for test-driven feature work or regression coverage, and from implement whenever production behaviour changes. Do not use for changes with no executable behaviour, and never commit or push automatically.
---

# Test-driven development

Use tests as executable behavioural specifications, not as coverage decoration.
Work in tracer-bullet cycles: one behaviour, one failing test, one minimal
implementation, then repeat based on what the previous cycle taught.

Invoking this skill authorizes scoped local test and production edits when the
user has asked for implementation. It does not independently authorize a fix
when the user requested diagnosis only, nor does it authorize commits, pushes,
dependency installation, remote infrastructure changes, or pull requests.

## Establish the seam

Read the authoritative issue or request, the applicable context and ADRs from
`docs/agents/domain.md`, the existing tests, and the affected component's test
harness and focused-test command in `docs/agents/verification.md`. Handle a
missing profile file, or a `TODO` or `None` value, as the
[project profile](../../references/project-profile.md) describes. Reuse the
test seams from an approved specification or `start-issue` handoff when
available.

If the seam changes or depends on a boundary between parts that ship or version
separately, follow `cross-boundary-contract` before writing the test. Keep
tests, diffs, and verification separate for each affected Git repository and
prove compatibility at the shared boundary.

A seam is a stable public boundary where a caller can exercise and observe the
behaviour without reaching into private implementation. Prefer the narrowest
seam that still proves the real contract, such as:

- a pure function or public type;
- an API route request and response, or an RPC call;
- a persistence interface using a local test database or temporary store;
- a message, event, or wire-format encoder and decoder;
- an application use case or view model through injected external clients;
- a fixed-timestep game simulation advanced with scripted inputs;
- a CLI invocation asserting exit code, output, and files written; or
- a UI interaction through the component's existing supported harness.

The component's platform guide in
[platforms](../../references/platforms/README.md) lists the seams that usually
exist there.

State the chosen seam before writing the first test. Use a seam already agreed
in the issue plan without asking again. If no seam exists, propose the smallest
one and ask only when choosing it would materially alter the public interface,
architecture, cost, or scope.

## When no harness fits the seam

Do not install or replace a test framework as incidental feature work. A
component may have no test runner at all, which `docs/agents/verification.md`
records as `None` for the test harness. It may also have a runner that cannot
reach the seam a behaviour needs, such as a unit-test runner with no way to
drive the UI or to start a local server. Either way, report the gap. Then use
an approved lower seam that a harness reaches, or use the strongest local
evidence the component offers as the red and green observations: a request
against the local route, a CLI run, a scripted play-test step, or a browser or
simulator check. Record the exact command or steps for both observations. Name
the missing harness in the handoff so a separate issue can add one. If the
behaviour cannot be observed locally at all, return the test-foundation work to
issue planning.

## Write tests worth keeping

- Test behaviour through public interfaces. A refactor that preserves behaviour
  should not break the test.
- Name the capability or outcome, not the private method or call sequence.
- Derive expected results from the issue, a worked example, protocol contract,
  or known literal—not by repeating the implementation's algorithm in the test.
- Keep one coherent behavioural reason for failure per test. Multiple assertions
  are acceptable when together they describe one response or state transition.
- Prefer real controlled collaborators where practical. Mock only genuine
  system boundaries such as external services, time, randomness, filesystem, or
  occasionally a database when the real test database is not the correct seam.
- Do not mock internal modules, assert private calls, or use call counts as a
  substitute for observable behaviour.
- Keep fixtures minimal and deterministic. Pin time, randomness, frame timing,
  locale, and network dependencies when they affect the result.

## Run the red-to-green cycle

For each behavioural slice:

1. **Specify:** State one concrete behaviour and its done condition at the
   selected seam.
2. **Red:** Add the smallest test that expresses that behaviour. Run the exact
   focused command and observe it fail for the expected missing or incorrect
   behaviour.
3. If the test passes before the implementation, determine whether the behaviour
   already exists, the assertion is insensitive, or the seam is wrong. Do not
   manufacture a failure or proceed with a test that never proved it could catch
   the problem.
4. If it fails because of broken setup, compilation, fixtures, or environment,
   fix only the in-scope test precondition or report the blocker. That is not a
   valid red result for the product behaviour.
5. **Green:** Make the minimum production change needed to satisfy this test.
   Do not implement speculative future cases.
6. Rerun the focused command and observe the test pass. Then run the nearest
   related tests needed to catch local regressions.
7. Show the relevant test and production diff, explain the behaviour now proven,
   and record the red and green commands and outcomes.
8. Repeat with the next vertical slice. Never write the entire test suite first
   and the entire implementation second.

Keep cleanup separate from the red-to-green evidence. Once a slice is green,
perform only useful behaviour-preserving cleanup, show it separately, and keep
the focused tests green. Larger refactoring belongs in an explicit step or
issue rather than being hidden inside a TDD cycle.

## Existing and defective behaviour

For a defect, use the minimized reproduction from `diagnosing-bugs` to create a
regression test at the correct seam. Watch it fail before the fix, make the
smallest root-cause correction, watch it pass, and rerun the original broader
reproduction.

For legacy behaviour without tests, use a characterization test only when the
current output is intended to remain stable. Do not encode a known bug as the
desired contract. If the architecture exposes no correct seam, report that
finding instead of adding a shallow test that provides false confidence.

## Completion

Finish with:

- the seam and behaviours covered;
- red evidence for every cycle;
- green and related-test evidence;
- the relevant diff and resulting observable behaviour;
- any necessary cleanup separated from behavioural changes; and
- missing seams or harnesses, untested integration paths, or environment
  prerequisites.

Link the driving issue and any other GitHub object the report names, per the
[GitHub reference rules](../../references/github-references.md).

Do not commit, push, open a pull request, or claim the broader issue is complete;
return control to `implement` or the user after the scoped TDD work is green.
