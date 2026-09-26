# Web platform guide

Applies to browser applications and sites, including server routes, server
actions, and background jobs that ship with them. `docs/agents/verification.md`
holds the real commands. This guide supplies the defaults.

## Test seams

- Pure functions for formatting, validation, parsing, and state reducers.
- Components through the project's existing runner, such as Vitest or Jest with
  Testing Library. Assert what the user sees and can do, not internal state.
- Route handlers and server actions through a request and its response.
- Persistence through a local test database and its access rules.
- End-to-end browser flows through the project's existing harness, such as
  Playwright or Cypress.

Do not add a test runner or browser harness as incidental work. When the
component has no test runner, record the gap, and use a local HTTP request or a
browser pass as the red and green observations.

## Runtime evidence

1. Start or reuse the local stack with the documented commands. Check whether
   a healthy server is already running before starting a duplicate.
2. Do not run a production build in a checkout where a development server is
   running unless the project documents that it is safe. Several frameworks
   share one build directory between the two.
3. Exercise the real flow in a real browser: navigate, sign in with a
   disposable local account, enter data, submit, refresh, and download, as the
   criterion requires. Use the project's documented browser-test command when
   one exists; otherwise drive an available real browser without installing a
   new harness.
4. For an API route, send the request the real client sends, including the
   origin, authentication, and content-type headers it depends on. Record the
   status and the response fields the criterion names. Redact keys and tokens.
5. Capture evidence that fits the claim: a screenshot for visual state, a
   response body for API behaviour, the downloaded file for export behaviour,
   and the console and network state. Store it outside the repository.
6. Treat console errors, failed requests, hydration warnings, and broken assets
   as evidence. A page that looks right is not automatically a pass.
7. Check what the criterion implies about access and layout: keyboard
   reachability, focus order, labels, contrast, and a narrow viewport.

Evidence categories to report separately:

- automated checks: tests, lint, type-check, and build;
- local runtime: browser and HTTP observations against the local stack;
- online targets: preview deployments, staging, production, and hosted
  databases, which need explicit approval;
- third-party services: payments, email delivery, AI APIs, analytics, and
  identity providers, which need approval and a sandbox or test mode.

## Bug feedback loops

- Replay the failing request with `curl` or the project's HTTP client, with
  credentials redacted and supplied from the environment.
- Script the click path in the existing browser harness.
- Use the browser's network throttling and offline mode for timing and
  connectivity bugs.
- Bisect commits with `git bisect run` over a scripted reproduction.

## Compatibility at boundaries

- Open tabs keep running an old bundle after a deploy, so an old client can
  call a new API. Keep route and payload changes additive.
- Scripts embedded on pages you do not control are a public contract with
  markup you cannot update.
- CDN caches and service workers can serve old assets after a release.
- Support the browsers the project names. Do not assume the latest version.
- A schema migration and the code that reads it deploy separately. Apply the
  migration first and keep the old shape readable until nothing depends on it.

## Visible-first order

For teaching and slice planning: the page or component with placeholder data,
then local interaction states such as loading, empty, and error, then the data
contract, then the client integration layer, then the server route or action,
then persistence, then replacing the placeholders, then verification of the
complete flow.
