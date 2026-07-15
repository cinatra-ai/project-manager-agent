# Blog Content Publish

A specific project agent: it ships the typed `cinatra/project-template.json`
for a review-gated blog publish — the re-cut of the retired blog-content BPMN
workflow — which the generic Project Manager agent instantiates into the
configured PM work store and ticks to completion. See `PARITY.md` for the
task-by-task mapping from the BPMN original.

## Works with

- The Project Manager agent (`@cinatra-ai/project-manager-agent`) as the PM seat that instantiates and ticks this template.
- Any connected `pm-work-store` provider (the plane-connector today).

## Capabilities

- Materializes a four-task publish plan (review, WordPress draft, publish, notify) driven by dependency order rather than calendar dates.
- Blocks the WordPress draft behind a human organization approval gate; the approval and checkpoint tasks surface as human-assigned work items in the PM tool.
- Dispatches the WordPress draft to `@cinatra-ai/blog-wordpress-publish-agent` through the role-keyed `wordpress-draft-writer` binding, machine-checked against this manifest's dependency edges at install.
