# Service platform guide

Applies to back-end services, HTTP and RPC APIs, workers and scheduled jobs,
databases and their migrations, and infrastructure as code.
`docs/agents/verification.md` holds the real commands and local services. This
guide supplies the defaults.

## Test seams

- Domain logic as pure functions or use cases with injected repositories,
  clocks, and external clients.
- Handlers through a request and its response, including status codes, error
  bodies, and headers the contract promises.
- Persistence through a local test database: queries, constraints, access
  rules such as row-level security, and migrations applied to a copy of the
  previous schema.
- Messages, events, and webhooks through their payload contract, including
  retries and duplicate delivery.
- Jobs through one invocation with controlled input and time.
- Infrastructure through a plan or dry run, never an apply.

Mock only real system boundaries: external services, time, randomness, and the
network. Do not add a test framework as incidental work.

## Runtime evidence

1. Start or reuse the local services with the documented commands, and check
   their health before starting duplicates.
2. Send the real request or enqueue the real message, and record the status,
   the response or resulting state, and the logs the criterion depends on.
   Redact credentials, tokens, and personal data.
3. Apply a new migration to the local database only, then confirm the schema,
   constraints, and access rules with read-only queries. Ask before a reset that
   deletes local data unless the user identified the database as disposable.
4. Never run a remote migration, deploy, or infrastructure apply during
   verification.

Report separately: automated checks; local runtime observations; online targets
such as staging, production, hosted databases, and queues, which need explicit
approval; and third-party services such as payments, email, and AI APIs, which
need approval and a sandbox or test mode.

## Bug feedback loops

- Replay the failing request, message, or webhook payload, redacted, against
  the local service.
- Seed the local database with the minimal records that reproduce the failure.
- Run a job once with the failing input and a pinned clock.
- Use a seeded concurrency or load loop for races and timeouts.
- Bisect commits with `git bisect run` over a scripted reproduction.

## Compatibility at boundaries

- During a rolling deploy, old and new instances serve traffic together, and
  clients of every supported version call the service. Keep contracts
  additive, and remove the old form in a later change.
- A migration and the code that reads it deploy separately. Apply an additive
  migration first, then the code, then any cleanup.
- Queued messages and retried webhooks carry the old payload after a deploy.
- Configuration and environment variables are part of the contract between the
  service and its deployment.

## Visible-first order

For teaching and slice planning, work contract-first: the request and response
with a stubbed handler that returns a fixed example, then validation and error
responses, then the domain logic, then persistence, then side effects such as
messages and emails, then replacing the stub, then an end-to-end request.
