# Optional recap metrics

These metrics need additional collection. The default report does not claim them.

| Metric | Required evidence | Interpretation |
| --- | --- | --- |
| Issues completed | Closure timestamps, completion reasons, and an explicit attribution rule, such as assignment or a closing PR authored by the user | Separate completed from not planned. A closer is not necessarily the implementer. Current assignment does not prove assignment at closure. |
| Issue closures performed by you | Paginated issue timeline events with actor and event time | Administrative actions. Count unique issues separately from closure events. Include reopened issues when counting past events. |
| PRs closed without merging | Close events and merge state at the relevant time | Abandoned or superseded work can be useful context. Latest `closedAt` alone misses earlier close and reopen cycles. |
| Time to first review | PR opening or ready-for-review event, plus the first submitted review by another human | Declare the starting event and whether bots are excluded. Distinguish first review ever from first review during this sprint. |
| Review turnaround | Review-request events matched to the user's next submitted review | Repeated requests and requests withdrawn before review need explicit handling. |
| Bugs completed | Completed issues or merged PRs with verified bug classification | Current labels may differ from labels at completion. Do not infer a bug from every change title. |
| Work by area | Repository counts or verified labels on the recorded activity | Counts overlap if one item has several labels. Repository totals already appear in the default output. |
| Commits and changed lines | Commit author identity, branch scope, and deduplicated commit SHAs, or a declared PR diff cohort | Squashes, rebases, generated files, and coauthors change these totals. These are change-volume measures, not productivity scores. |
| Releases and deployments | Release or deployment records, timestamps, environment, and a traceable link to the user's changes | A merge does not prove that a change reached production. |
| Planned work completed, carryover, and scope change | Saved sprint-start membership, assignment, estimates, and end-state evidence | A current board snapshot cannot recover the original commitment. Parent and child issues must not inflate delivered totals. |
| Story points completed | Consistent estimates, completion evidence, attribution, and a declared parent or child counting level | Do not invent estimates or compare unlike estimation schemes. |
| Change against previous sprint | The same definitions, repository scope, permissions, timezone, and coverage for both periods | Compare complete sprints, or equal elapsed portions explicitly. A partial sprint is not comparable to a full sprint. |

Event timestamps establish when something happened. `updatedAt` only identifies
candidates for further inspection. It does not identify the actor or the action.
Use the underlying event or review record before attributing activity to the user.
Deduplicate issues and PRs by URL, not by number across repositories.

GitHub supports author, repository, review, creation, and merge search filters in
its [issue and PR search documentation](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests).
The [review API](https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request)
provides submission timestamps. The [PR API](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request)
provides merge timestamps and the recorded merger.
Search has [result limits and incomplete-result responses](https://docs.github.com/en/rest/search/search).
Do not silently treat a limited result set as a complete measurement.
