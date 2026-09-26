# Library and CLI platform guide

Applies to libraries, SDKs, packages, plugins, frameworks, and command-line
tools. `docs/agents/verification.md` holds the real commands, supported
runtime versions, and release process. This guide supplies the defaults.

## Test seams

- The public API, called the way a consumer calls it. Test through exported
  functions and types, not internals.
- Examples and documentation snippets that compile or run, where the project
  checks them.
- For a CLI, one invocation with arguments, input, and environment, asserting
  the exit code, standard output, standard error, and files written. Golden
  files suit stable output.
- Parsing and serialization through round trips and fixtures, including inputs
  written by older versions.
- The supported runtime and platform matrix the project already runs in CI.

Do not add a test framework as incidental work. Record the gap instead.

## Runtime evidence

- **Automated checks:** tests, type checks, lint, and a package build.
- **Consumer check:** a throwaway consumer outside the repository that installs
  the local build and uses the changed API, or the CLI run from a clean
  temporary directory. Delete it afterwards.
- **Matrix:** runtime versions, operating systems, and architectures the
  project supports. A combination that could not run locally is
  `Not verified`.
- **Publishing:** registries, package indexes, and release pages are online and
  public. Never publish, tag, or upload during verification.

## Bug feedback loops

- A minimal consumer or command line that reproduces the report.
- A property or fuzz loop for parsers and encoders.
- `git bisect run` over the reproduction.
- The consumer's exact dependency versions, pinned, when a bug depends on them.

## Compatibility at boundaries

- Every public name, signature, default, error type, exit code, flag, output
  format, and file format is a contract with consumers you cannot update.
- Follow the project's versioning policy. Under semantic versioning, a breaking
  change needs a major version, a migration note, and ideally a deprecation
  period first.
- Transitive dependency changes and minimum runtime versions can break
  consumers without an API change.
- Scripts parse CLI output. Changing wording in machine-readable output is a
  breaking change. Add a flag or a new format instead.

## Visible-first order

For teaching and slice planning, work caller-first: write the usage example or
command line the user will type, with a stub that returns a fixed result, then
argument validation and error messages, then the real logic, then edge cases
and errors, then documentation and the changelog entry.
