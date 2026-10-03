---
name: to-spec
description: Turn the current conversation into a written specification by synthesizing what has already been discussed, without re-interviewing the user. Establish test seams, screen the work against the 16 software-quality characteristics, and route boundary changes through cross-boundary-contract. Use when a discussion needs to become a durable spec, or from start-issue when an issue lacks usable acceptance criteria. Do not use to invent requirements that were never discussed, and never publish or update a GitHub issue without explicit authorization.
---

# To spec

Convert the current conversation and codebase understanding into a specification
someone else could implement. Do not interview the user. Synthesize what has
already been established, and ask only about a decision that genuinely blocks
the spec.

Invoking this skill authorizes reading the project and writing a
specification. It does not authorize implementation, branches, commits, or any
GitHub mutation. Publication is a separate, explicitly authorized step.

## Ground the spec

1. Read enough of the current code and tests to replace assumptions with
   evidence: entry points, the modules the change touches, existing contracts,
   and the tests that already cover the area.
2. Read the documents in the reading order of `docs/agents/domain.md`: the root
   `AGENTS.md`, the glossary, the architecture overview, the guide for each
   component involved, and any ADRs governing the area. In a workspace of
   independent repositories, include each affected repository's own
   `AGENTS.md`. Use the glossary's vocabulary throughout the spec and respect
   the ADRs. Handle a missing profile file, or a `TODO` or `None` value, as the
   [project profile](../../references/project-profile.md) describes.
3. Determine which component and repository own each deliverable using the
   routing table in `docs/agents/issue-tracker.md`. Treat components the profile
   marks as legacy or inactive as out of scope unless the discussion explicitly
   targets them. For a product outcome spanning components, follow the
   profile's rule for such work.
4. If the work changes or depends on a boundary between parts that ship or
   version separately, such as an API, schema, authentication model, message
   payload, save or file format, network protocol, library surface, or
   installed client, follow `cross-boundary-contract` before writing the spec.
   Record the current and proposed contract, every producer and consumer, the
   compatibility decision, and the rollout and rollback order.

Distinguish what the user actually decided from what you are proposing. Mark
every proposed element as proposed.

## Sketch the test seams

Sketch the seams at which the feature will be tested. Prefer existing seams to
new ones, and use the highest seam that still proves the real contract. The
fewer seams across the codebase, the better; the ideal number is one. If a new
seam is needed, propose it at the highest point you can.

Name the seams concretely for the components involved, using each component's
test harness and runtime evidence from `docs/agents/verification.md` and the
seams its platform guide in [platforms](../../references/platforms/README.md)
describes. When a component has no test runner, say so rather than assuming
one exists. Record the real commands and prerequisites, including any
credential, local service, simulator, physical device, target hardware, or
paid-service requirement.

Check with the user that these seams match their expectations before writing the
spec.

## Screen against the quality characteristics

Before writing the spec, screen the work against the 16 characteristics in the
[software quality characteristics](../../references/software-quality-characteristics.md),
starting from the project's `Quality weighting` in `docs/agents/domain.md`.
Weight them by the risk this work actually carries rather than treating them as
a uniform checklist.

For every characteristic that carries material risk, fold the outcome into the
spec: an acceptance criterion or user story when it describes observable
behaviour, an implementation decision when it constrains the design, a testing
decision when it determines what must be proven, or an explicit entry under
`Out of Scope` when it is deliberately deferred. State a deferral and its reason
rather than leaving a known risk unmentioned.

Do not add a section listing all 16. The spec should read as a specification,
not as a quality audit.

## Write the spec

Use the template below. Keep the prose to the standards in `technical-writing`
and `unslop`.

<spec-template>

## Problem Statement

The problem the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A long, numbered list of user stories, each in the format:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a returning user, I want to see when my data last synchronised, so that I
   can tell whether what I am looking at is current.
</user-story-example>

Cover all aspects of the feature, including the error, offline, permission,
limit, and recovery paths the quality screen surfaced.

## Implementation Decisions

The decisions that were made, which can include:

- the modules that will be built or modified, and the owning component and
  repository for each
- the interfaces of those modules that will change
- technical clarifications from the developer
- architectural decisions and the ADRs they follow or supersede
- schema, save-format, or stored-data changes and their migration and rollback
  path
- contracts at any boundary, with the compatibility decision and rollout order
- specific interactions

Do not include specific file paths or code snippets. They may end up being
outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more
precisely than prose can, such as a state machine, reducer, schema, or type
shape, inline it within the relevant decision and note briefly that it came from
a prototype. Trim it to the decision-rich parts rather than a working demo.

## Testing Decisions

The testing decisions that were made. Include:

- what makes a good test here: it exercises external behaviour through a public
  seam, not implementation details, and survives a behaviour-preserving refactor
- which modules will be tested, at which seam, with the exact commands
- prior art in the codebase for those tests
- missing test harnesses and the evidence that replaces them
- verification that requires credentials, a simulator, a physical device,
  target hardware, a human play-test, hosted infrastructure, a paid third-party
  API, or approval, and what that leaves unproven locally

## Out of Scope

What this spec deliberately does not cover, including quality risks that were
identified and consciously deferred.

## Further Notes

Any further notes about the feature.

</spec-template>

## Publication is a separate authorization

Present the finished spec to the user first. Do not create or edit a GitHub
issue as part of writing it.

When the user authorizes publication, use `create-issue` and follow its
grounding rules. It selects the repository, issue form, existing labels, issue
type where one applies, board status, and any parent sub-issue relationship.
Use the tracker's existing label vocabulary; never invent a triage label. For
work spanning repositories, follow the profile's rule, such as keeping or
creating the umbrella issue and publishing the implementation deliverables to
the repositories that own them.

If the spec refines an existing issue rather than creating a new one, draft the
replacement body or comment, show it to the user, and publish it only after
explicit approval. Never replace an existing issue with a newly published one.

## Handoff

Return the spec plus:

- the components and repositories that own each deliverable and why, with
  every issue, pull request, or discussion the spec cites linked per the
  [GitHub reference rules](../../references/github-references.md). Inside text
  destined for a GitHub issue, use the plain `#number` or `owner/repo#number`
  autolink;
- the agreed test seams, commands, and prerequisites;
- contract, compatibility, and rollout implications for any shared boundary;
- the quality risks that shaped the spec and those deliberately deferred;
- the decisions that remain genuinely unresolved and block safe implementation;
- publication state: unpublished, awaiting approval, or the issue that was
  created or updated with authorization.

Stop with the spec written. Implementation starts from `start-issue`.
