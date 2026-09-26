# Software quality characteristics

Sixteen characteristics describe what makes software good. They are grouped as
operational (how the software behaves while running), revision (how safely it
can be understood and changed), and transition (how well it crosses system and
environment boundaries).

This file is the single source of truth for the model. Skills reference it
instead of restating it, so planning, implementation, verification, and review
argue about quality in the same vocabulary. When a characteristic's definition
needs to change, change it here, in the fleet.

The model is a thinking tool, not a checklist to satisfy uniformly. Weight it by
the risk the work actually carries, and record `Not applicable` once rather than
manufacturing a decision, an abstraction, or a finding for every entry.

## How each workflow uses this file

| Workflow | Obligation |
| --- | --- |
| `to-spec` | Name the characteristics that carry material risk for the feature and fold the resulting decisions into the specification's implementation and testing decisions. |
| `start-issue` | Screen the issue against the model, record a decision or an explicit deferral for every characteristic that carries material risk, and turn each one into acceptance criteria, test seams, or a named non-goal. |
| `implement` | Hold each vertical step to the recorded decisions, and surface any new risk a step exposes instead of absorbing it silently. |
| `tdd` | Choose seams that serve testability and write assertions that prove correctness and reliability rather than mirroring the implementation. |
| `verify-work` | Gather acceptance evidence, then delegate the engineering axis to `pr-review` against the same diff. |
| `pr-review` | Assign a coverage status to all 16 characteristics and name the materially affected ones in every finding. |

Planning states a decision as `Decided`, `Deferred` with a reason, or
`Not applicable`. Review states coverage with the statuses at the end of this
file. A planning deferral is a legitimate answer; an unstated one is not.

## Operational characteristics

These describe externally observable behaviour while the software runs.

### Correctness

- **Means:** satisfies stated requirements, contracts, and expected results.
- **Plan:** derive acceptance criteria that name observable outcomes, including
  boundaries, invalid input, and error results, not just the happy path.
- **Build:** implement the specified behaviour and nothing beyond it; resolve a
  requirement conflict with the issue rather than guessing.
- **Evidence:** check reachable paths, boundary cases, validation, calculations,
  state transitions, and error results against specifications, tests, and
  runtime observations.

### Usability and learnability

- **Means:** intended users can discover, understand, and operate the software
  with reasonable effort.
- **Plan:** decide the user-visible surface, the default state, the empty and
  loading states, the error wording, and the recovery path before building. For
  a game, include how the player learns the mechanic and what feedback tells
  them it worked.
- **Build:** write the messages, labels, and defaults a user will actually meet;
  keep them consistent with existing product language and accessible.
- **Evidence:** examine UI or public API clarity, consistency, accessibility,
  labels, defaults, errors, documentation, and recovery. Prefer interaction
  evidence; code alone rarely verifies usability.

### Integrity

- **Means:** avoids unintended side effects on other components, applications,
  and state.
- **Plan:** identify the state the change writes, who else owns it, and what a
  partial failure must leave behind.
- **Build:** keep writes transactional or idempotent, clean up on failure, and
  stay inside the data your component owns.
- **Evidence:** examine transactions, partial failure, cleanup, isolation,
  idempotency, ownership, and compatibility boundaries for corruption or
  collateral effects. Distinguish this from security while noting genuine
  overlap.

### Reliability

- **Means:** behaves consistently and fails predictably.
- **Plan:** decide the timeout, retry, cancellation, offline, and degraded
  behaviour the feature requires, and make them acceptance criteria.
- **Build:** handle the failure path in the same step as the success path rather
  than deferring it to a later slice.
- **Evidence:** examine timeouts, retries, invalid state, partial dependencies,
  cancellation, concurrency, restart, exhaustion, error handling, idempotency,
  fallback behaviour, and regression evidence.

### Efficiency

- **Means:** uses time, memory, storage, network, database, and compute
  resources effectively.
- **Plan:** state the expected data volume and call frequency, and note any
  budget the feature must respect, such as a frame-time, memory, battery, or
  bundle-size budget.
- **Build:** avoid repeated or unbounded work in the obvious places; measure
  before optimising anything less obvious.
- **Evidence:** look for unbounded or repeated work, N+1 access, excessive
  payloads, blocking operations, leaks, unnecessary rendering, and avoidable
  allocations. Treat performance as unverified without measurements when scale
  matters.

### Security

- **Means:** protects systems and data from unauthorized access, disclosure,
  manipulation, and disruption.
- **Plan:** name the trust boundary, the authenticated actor, the authorization
  rule, and the sensitive data the change touches.
- **Build:** validate untrusted input, enforce ownership at the boundary that
  owns the data, keep secrets out of code and logs, and choose secure defaults.
- **Evidence:** examine authentication, authorization, ownership, input trust,
  injection, secrets, sensitive output, cryptography, dependencies, logging, and
  secure defaults. Do not call manifest inspection a current vulnerability scan.

### Safety

- **Means:** avoids unacceptable risk to people, the environment, property, and
  other high-consequence interests.
- **Plan:** identify irreversible or hazardous actions the feature enables and
  decide the confirmation, limit, or override each one needs.
- **Build:** make destructive actions explicit, reversible, or audited; fail
  towards the safe state.
- **Evidence:** consider hazardous or irreversible actions, fail-safe defaults,
  limits, confirmations, interlocks, auditability, rollback, human override, and
  safe degradation. Mark not applicable only after considering the domain.

## Revision characteristics

These describe how safely and economically the software can be understood,
tested, changed, and expanded.

### Maintainability

- **Means:** developers can understand, diagnose, and change the software
  without disproportionate effort.
- **Plan:** decide where the change belongs in the existing structure instead of
  letting placement fall out of the diff.
- **Build:** follow local conventions, name things for what they do, and delete
  what the change replaces.
- **Evidence:** examine names, control flow, dependencies, documentation,
  errors, local conventions, duplication, dead code, hidden coupling,
  complexity, and unnecessary dependencies.

### Flexibility

- **Means:** accommodates credible, likely variations without invasive change.
- **Plan:** name the variations that are actually expected, and say explicitly
  which ones are out of scope.
- **Build:** express a known variant as data or configuration at one point
  rather than scattering assumptions; do not build for an unnamed one.
- **Evidence:** check whether known variants use clear data, configuration, or
  stable seams instead of scattered assumptions. Do not demand speculative
  configurability.

### Extensibility

- **Means:** supports expected new capabilities without widespread modification
  or broken behaviour.
- **Plan:** identify the capabilities the roadmap or issue already anticipates
  and where they would attach.
- **Build:** keep the attachment point honest and small; prefer an added case
  over a new framework.
- **Evidence:** examine extension points, contracts, repeated closed
  conditionals, leaky abstractions, and changes that touch unrelated layers.
  Avoid premature frameworks.

### Scalability

- **Means:** handles more users, data, work, or instances without
  disproportionate degradation.
- **Plan:** state the growth dimension that matters and the limit the design
  must hold to.
- **Build:** bound queries, payloads, queues, and retained state; paginate where
  a collection can grow.
- **Evidence:** examine bounds on work, queues, queries, payloads, connections,
  and state, plus contention, pagination, statelessness, backpressure, and
  operational limits. Require load evidence for strong claims.

### Testability

- **Means:** important behaviour can be controlled, observed, and verified
  efficiently.
- **Plan:** choose the test seams during planning, at the highest stable
  boundary that proves the real contract, and record the exact commands.
- **Build:** keep behaviour reachable from that seam, inject clocks, randomness,
  and external clients, and assert observable behaviour.
- **Evidence:** examine determinism, isolation from clocks, randomness,
  network, storage, and global state, behavioural assertions, failure coverage,
  boundary tests, mock-only confidence, skipped tests, and swallowed failures.

### Modularity

- **Means:** cohesive units have explicit responsibilities and limited,
  intentional coupling.
- **Plan:** decide which module owns the new behaviour and which contracts it
  may depend on.
- **Build:** keep dependency direction consistent, avoid widening a contract for
  one caller, and resist shared mutable state.
- **Evidence:** examine dependency direction, contract width, cycles, shared
  mutable state, oversized modules, cross-layer leakage, and tiny abstractions
  that fragment understanding without useful isolation.

## Transition characteristics

These describe how well the software crosses system, purpose, and environment
boundaries.

### Interoperability

- **Means:** exchanges and uses information correctly with other applications or
  components.
- **Plan:** treat any producer-consumer boundary as a contract change, follow
  `cross-boundary-contract`, and decide the compatibility and rollout order
  before implementation.
- **Build:** keep the wire shape, units, encodings, and error semantics
  backward-compatible where a rolling deployment or an installed client can mix
  versions.
- **Evidence:** examine protocols, schemas, serialization, units, encodings,
  error semantics, versions, compatibility behaviour, timeouts, contract tests,
  and integration evidence.

### Reusability

- **Means:** cohesive code or components can serve another valid purpose with
  limited modification.
- **Plan:** note when a second consumer already exists; otherwise plan for one
  purpose.
- **Build:** keep product-specific assumptions out of code that a known second
  consumer will use; do not extract for a hypothetical one.
- **Evidence:** examine product-specific coupling, contracts, parameters, and
  dependency control. Do not penalize intentionally single-purpose code or
  demand extraction without a credible reuse case.

### Portability

- **Means:** preserves intended behaviour across required platforms and
  environments.
- **Plan:** name the platforms, devices, browsers, input methods, locales, and
  environments the work must support, and which of them can be verified
  locally.
- **Build:** avoid hard-coded paths, implicit locales and time zones, and
  undeclared runtime requirements.
- **Evidence:** examine hard-coded paths, case sensitivity, locale and time-zone
  dependence, architecture, browsers, databases, filesystem semantics, line
  endings, environment configuration, undeclared runtime needs, and available
  platform evidence.

## Risk-based weighting

Use these as starting points, then follow the product context:

- Safety- or mission-critical systems: prioritize Correctness, Safety,
  Reliability, Integrity, and Security.
- User-facing business software: prioritize Correctness, Usability and
  learnability, Reliability, Security, and Maintainability.
- Mobile and desktop apps installed on users' devices: prioritize Correctness,
  Reliability offline and across interruptions, Integrity of local data,
  Interoperability with older installed versions, Portability across devices
  and OS versions, and Efficiency of battery, memory, and startup.
- Games: prioritize Correctness of game rules, Usability and learnability
  through feel, feedback, and accessibility, Efficiency against the frame-time
  and memory budget, Reliability of saves and sessions, Integrity of save data,
  and Portability across target platforms and input devices.
- Libraries, APIs, SDKs, and platforms: prioritize Correctness,
  Interoperability, Portability, Reusability, Extensibility, and
  compatibility-related Integrity.
- High-volume systems: prioritize Scalability, Efficiency, Reliability,
  Integrity, and observability that supports Testability.
- Fast-changing products: prioritize Maintainability, Flexibility,
  Extensibility, Modularity, and Testability without sacrificing operational
  correctness.

Each project records its own weighting in the `Quality weighting` section of
`docs/agents/domain.md`. Start from that section, then adjust for the work at
hand. Any boundary between separately shipped parts carries interoperability
and compatibility weight that neither side's checks can verify alone.

## Coverage statuses

Review workflows assign one status to every characteristic:

- `Concern` - evidence supports one or more reportable improvements;
- `No concern found` - reviewed evidence revealed no material issue;
- `Not verified` - the characteristic matters, but required runtime, scale,
  platform, integration, or domain evidence is unavailable;
- `Not applicable` - the characteristic genuinely does not apply to this scope;
- `Not assessed` - a deliberately narrow review did not examine it deeply
  enough.

`No concern found` is narrower than `Pass`. Do not certify absence of defects
from static inspection. Do not force a finding for every characteristic,
manufacture speculative future needs, or reward abstraction for its own sake.

## Evidence discipline

- Source inspection may establish a concrete defect, but usually cannot prove
  usability, runtime reliability, scalability, portability, or integration by
  itself.
- A test pass supports only the behaviour, environment, and assertions
  exercised.
- A clean diff or familiar pattern is not evidence of correctness.
- Missing evidence produces `Not verified`, `Not assessed`, or an unverified
  risk, not a confident pass or an invented finding.
