# BPMN → typed-template parity (task by task)

Source: `blog-content-workflow/cinatra/workflow.bpmn` (the `blog-content-workflow`
process, "Blog Content Publish"). Target: `cinatra/project-template.json` in this
directory (`blog-content`, format `cinatra.ai/project-template@1`).

Unlike the major-release re-cut (`release-announcement`), the blog-content
workflow carries **no `cinatra:taskSchedule`** on any task — it is a
review-gated, dependency-ordered publish flow, not a calendar flow. So no task
carries a `schedule`/`dueOffsetDays`; the `anchor` is declared because the
contract requires one, but nothing resolves against it (a target publish date is
additive future work). The point this template exercises is the **approval gate
+ the dashboard/board semantics**, not dates.

| BPMN element | BPMN semantics | Template task | Parity notes |
|---|---|---|---|
| `review_publish_bundle` (userTask, `taskKind=approval`, `approvalConfig level=organization rejectionPolicy=needs_revision`) | Organization-level human approval that GATES the whole publish | `review`, human task with `approval { id: "publish-review", assigneeRole: "organization" }`, no `dependsOn` (first task), one `acceptance` criterion | Approval gate parity exact (organization-level hint preserved in `assigneeRole`). `rejectionPolicy=needs_revision` maps to runtime behavior: a rejection returns the bundle for revision instead of cancelling the project — enforced by the PM tool workflow, not template state. |
| `create_wordpress_draft` (serviceTask, `agentRef @cinatra-ai/blog-wordpress-publish-agent`, `taskInput {"projectId","postId","wordpressInstanceId"}`) | Agent dispatch that creates the WordPress draft | `draft`, `worker { role: "wordpress-draft-writer", packageName: "@cinatra-ai/blog-wordpress-publish-agent" }`, `dependsOn: ["review"]` | Worker parity exact (same package, now role-keyed + manifest-checked by the one-truth-source rule). The `taskInput` placeholders (`projectId`/`postId`/`wordpressInstanceId`) ride the project INSTANCE + the dispatch `runInput`, not the task identity — task natural keys must stay parameter-independent (they feed the dispatch ledger's idempotency). |
| `publish_in_wordpress_admin` (manualTask) | A human publishes the created draft in the WordPress admin | `publish`, human task (no `worker`), `dependsOn: ["draft"]` | Exact. A manual task is a plain human work item; a person marks it done. |
| `notify_publish_checkpoint_complete` (sendTask, `messageBody`) | Automated "publish complete" notification | `notify`, human checkpoint (no `worker`), `dependsOn: ["publish"]` | **Deliberate delta** (same as the release-announcement `announce`): the BPMN sendTask was engine automation; the catalog has no send-message worker agent, so the re-cut keeps `notify` as a human checkpoint. Binding a messenger worker later is an additive template change. |
| `start` / `end` events, `sequenceFlow` edges (incl. `transitionOutcome=success`) | Linear control flow review → draft → publish → notify | `dependsOn` edges: `draft←review`, `publish←draft`, `notify←publish` | Exact: the dependency graph is the same chain; "success" transitions map to the deterministic ready rule (a blocker must be `done`; `cancelled` does NOT satisfy the edge). |
| `placeholders` (`projectId`, `postId`, `wordpressInstanceId`) | Install-time bound identifiers interpolated into task input | Not in the typed template's task identity | Deliberate: the same parameter-independence rule as above — the identifiers ride the project instance, not the template. |
| `cinatra/dashboard.json` (object-list panes + `workflow-launcher` portlet keyed `blog-content-workflow`) | The blog-content DASHBOARD that launches the publish workflow | Not in the typed project-template contract | The typed template is the task graph only; a dashboard is a separate dashboard-kind concern. The project board view is provided by the PM store (Plane) itself; the `workflow-launcher` portlet's "kick off publish" role maps to INSTANTIATING this project agent. Re-cutting the dashboard is a separate (dashboard-kind) follow-up, out of this template's scope. |

## Schedule-semantics summary

- The source workflow has **no calendar schedule**. Every task's readiness is
  purely `deps done + backlog/todo + unclaimed` (the deterministic ready rule);
  there is no start/due gate. This is strictly the sequence-flow ordering the
  BPMN implied, carried by dependency edges.
- The single worker dispatch (`draft`) sits BEHIND the approval gate (`review`),
  so the dispatch never fires until a human has signed off — the ordering the
  BPMN's `review → draft` sequence flow guaranteed.
