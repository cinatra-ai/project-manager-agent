# Release Announcement

A specific project agent: it ships the typed `cinatra/project-template.json`
for a product release announcement — the re-cut of the retired major-release
BPMN workflow — which the generic Project Manager agent instantiates into the
configured PM work store and ticks to completion. See `PARITY.md` for the
task-by-task mapping from the BPMN original.

## Works with

- The Project Manager agent (`@cinatra-ai/project-manager-agent`) as the PM seat that instantiates and ticks this template.
- Any connected `pm-work-store` provider (the plane-connector today).

## Capabilities

- Materializes a four-task release plan (kickoff, launch blog draft, legal sign-off, announce) with due dates computed back from a target release date.
- Dispatches the launch-blog draft to `@cinatra-ai/blog-pipeline-agent` through the role-keyed `launch-blog-writer` binding, machine-checked against this manifest's dependency edges at install.
- Blocks the announce step behind a human legal-approval gate; approval and checkpoint tasks surface as human-assigned work items in the PM tool.
