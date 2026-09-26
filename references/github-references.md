# GitHub reference links

Every GitHub object a report names must be openable from that mention. A bare
`#179` costs the reader a search. Producing the link costs nothing, because the
number almost always arrives from a response that already carries the URL.

This rule applies to all skills and to ordinary replies. Skills reference this
file instead of restating it.

## Which form belongs on which surface

| Surface | Form |
| --- | --- |
| Agent replies, terminal reports, and documents in the project | Markdown link with a repository-qualified label: `[api#179](https://github.com/acme/api/pull/179)` |
| Text published to GitHub: issue bodies, pull-request descriptions, issue and PR comments | Plain autolink: `#179` when the object lives in the same repository as the text, `owner/repo#179` otherwise |

GitHub turns `#number` and `owner/repo#number` into a titled, state-aware link
inside issues, pull requests, and comments, so a raw URL there is noise. On
every other surface the reader gets nothing unless the link is written.

Objects GitHub does not autolink still need a full URL, including in GitHub
text: project items, workflow runs, commit ranges, file lines, and releases.

## Reference shapes

| Object | URL |
| --- | --- |
| Issue | `https://github.com/<owner>/<repo>/issues/<number>` |
| Pull request | `https://github.com/<owner>/<repo>/pull/<number>` |
| Issue or PR comment | the `url` GitHub returns for that comment, with its anchor |
| Review thread | the `url` GitHub returns for that review or thread |
| Discussion | `https://github.com/<owner>/<repo>/discussions/<number>` |
| Commit | `https://github.com/<owner>/<repo>/commit/<sha>` |
| Comparison | `https://github.com/<owner>/<repo>/compare/<base>...<head>` |
| File lines | `https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<start>-L<end>` |
| Release or tag | `https://github.com/<owner>/<repo>/releases/tag/<tag>` |
| Workflow run | `https://github.com/<owner>/<repo>/actions/runs/<id>` |
| Project board | `https://github.com/orgs/<owner>/projects/<number>` for an organization, `https://github.com/users/<owner>/projects/<number>` for a user |

Pin a file link to a commit SHA rather than a branch name, so the cited lines
stay the lines you cited.

## Rules

1. Use the `url` the tool already returned, such as `gh ... --json url`, a
   GraphQL `url` field, or the `url` in the sprint scripts' output. Assemble a
   URL from the table above only when no response carries one.
2. Use the path that matches the object. `/issues/<n>` redirects to a pull
   request, but a redirect in a report means the reference was guessed.
3. Label every reference with its repository name, such as `api#179`, even in
   a single-repository project, so the label stays unambiguous once a report
   also cites a dependency's issue. Add the owner when two repositories the
   report names share a name. In a workspace of several repositories, an
   unqualified issue number is ambiguous: resolve the repository before using
   it.
4. Link each object on first mention in a section. Repeating the same link on
   the next line is noise, and so is a bare URL printed beside a link that
   already points at it.
5. Never invent a URL for something that does not exist yet, such as a pull
   request you plan to open. Name it and say it has not been created.
6. When a reference cannot be resolved, say it is unresolved and say what would
   resolve it. A wrong link is worse than a missing one.
