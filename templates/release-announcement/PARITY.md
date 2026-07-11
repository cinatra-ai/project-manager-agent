# BPMN → typed-template parity (task by task)

Source: `major-release-workflow/cinatra/workflow.bpmn` (the `major-release`
process). Target: `cinatra/project-template.json` in this directory
(`release-announcement`, format `cinatra.ai/project-template@1`).

| BPMN element | BPMN semantics | Template task | Parity notes |
|---|---|---|---|
| `kickoff` (userTask, `taskKind=checkpoint`, `P14D before target`) | Human checkpoint 14 days before the target date | `kickoff`, human task (no `worker`), `dueOffsetDays: -14` | Exact. A checkpoint is a plain human work item; a person marks it done. |
| `blog` (serviceTask, `agentRef @cinatra-ai/blog-pipeline-agent`, `taskInput {"brief": …}`, `P7D before target`, `localTime 09:00`) | Agent dispatch 7 days before target at 09:00 | `blog`, `worker { role: "launch-blog-writer", packageName: "@cinatra-ai/blog-pipeline-agent" }`, `dependsOn: ["kickoff"]`, `dueOffsetDays: -7` | Worker parity exact (same package, now role-keyed + manifest-checked). `taskInput.brief` → the dispatch `runInput` carries the item title/body as the brief. **Schedule semantics: the typed contract is day-granularity**, so the `09:00` local time is not representable — the item is due on the same calendar day; time-of-day nudging is tick behavior, not template state. |
| `legal` (userTask, `taskKind=approval`, `approvalConfig level=organization rejectionPolicy=needs_revision`, `P3D before target`) | Organization-level human approval 3 days before target | `legal`, human task with `approval { id: "legal-signoff", assigneeRole: "organization" }`, `dependsOn: ["blog"]`, `dueOffsetDays: -3` | Approval gate parity exact (organization-level hint preserved in `assigneeRole`). `rejectionPolicy=needs_revision` maps to runtime behavior: a rejection returns the drafted content for revision instead of cancelling the project — enforced by the PM tool workflow, not template state. |
| `announce` (sendTask, `messageBody`, `PT1H after target`) | Automated announce message 1 hour after target | `announce`, human task (no `worker`), `dependsOn: ["legal"]`, `dueOffsetDays: 0` | **Two deltas, both deliberate.** (1) Day granularity: `PT1H after` is sub-day, so the item is due ON the target day (`dueOffsetDays: 0`); it becomes ready only when `legal` is done, which preserves the ordering guarantee. (2) The BPMN sendTask was engine automation; the catalog has no send-message worker agent, so the pilot keeps announce as a human task. Binding a messenger worker later is an additive template change. |
| `start` / `end` events, `sequenceFlow` edges (incl. `transitionOutcome=success`) | Linear control flow kickoff → blog → legal → announce | `dependsOn` edges: `blog←kickoff`, `legal←blog`, `announce←legal` | Exact: the dependency graph is the same chain; "success" transitions map to the deterministic ready rule (a blocker must be `done`; `cancelled` does NOT satisfy the edge). |
| `workflowMeta` `{{product}}` placeholder | Install-time string interpolation into task names | Not in the typed contract | Deliberate: task identity must be parameter-independent (natural keys feed the dispatch ledger's idempotency). The product/release context rides the project instance (`projectRef`/`projectId`) and the dispatch `runInput`, not the task titles. |

## Schedule-semantics summary

- BPMN `offsetIso8601 P<n>D direction=before/after` → integer `dueOffsetDays`
  (negative = before the anchor), computed at materialization from the
  concrete anchor date; changing the anchor date re-computes dates onto the
  SAME items (anchor-independent natural keys).
- Sub-day precision (`localTime`, `PT1H`) is not template state in the typed
  contract (day-granularity `YYYY-MM-DD` by design, matching the PM work-store
  contract); ordering formerly implied by sub-day offsets is carried by
  dependency edges instead.
- BPMN schedules gated only the task's TIMING; the typed contract's readiness
  additionally requires dependency completion and unclaimed status, which is
  strictly stronger and matches the BPMN's sequence-flow ordering.
