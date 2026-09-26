# Domain-document configuration

`TODO` marks a value nobody has confirmed. `None` means the project deliberately does without it.

## Reading order

Before planning, implementing, or reviewing work, read:

1. the root `AGENTS.md` for working rules, commands, and safety constraints;
2. the glossary: TODO path, or `None`;
3. the architecture overview: TODO path, or `None`;
4. the guide or `README.md` for each component involved: TODO where they live, such as "the `README.md` beside each component" or "`docs/<component>.md`";
5. the contracts document: TODO path, or `None`, whenever the work may change a boundary listed below.

In a workspace of independent repositories, also read each affected repository's own `AGENTS.md` and documentation index.

## Context rules

- The glossary is implementation-free. Put modules, paths, routes, tables, commands, and data flows in the architecture and component guides.
- Use the glossary's terms in issues, specifications, pull requests, and reviews. When a new product concept appears in more than one place, add it to the glossary in the same change.
- Treat older specifications and planning notes as reference material, not as proof that a feature exists.

## Boundaries

Interfaces between parts that ship, deploy, or version separately, so that different versions of each side can run at the same time. `cross-boundary-contract` applies to any change that alters or depends on one. List `None` for a project that ships as a single unit and stores no data that outlives a release.

| Boundary | Producer | Consumers | Versions that can meet |
| --- | --- | --- | --- |
| TODO | TODO | TODO | TODO: such as "an app build from before the change calls the new API" |

## ADR ownership

Architecture decision records live in TODO `docs/adr/`. Create one only when a choice is hard to reverse, surprising without context, and the result of a real trade-off. Create the directory with the first qualifying decision. Routine implementation details, status notes, and plans do not become ADRs.

## Quality weighting

TODO: two to five sentences naming which of the 16 characteristics in `.agents/references/software-quality-characteristics.md` carry the most weight in this project and why, component by component where they differ.
