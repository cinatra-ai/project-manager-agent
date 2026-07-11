# Project Manager

Generic project-manager agent: instantiates a typed project template into the configured PM work store and ticks it to completion. Given an installed project agent's validated typed template and an anchor date, it creates the work items in your PM tool, dispatches the worker agents bound to each task, and routes approval tasks to humans. It never synthesizes templates and never discovers workers at runtime — bindings come from the template.

## Works with

- Any installed connector that provides the `pm-work-store` capability (Plane today; further PM-tool connectors work unchanged)
- Worker agents referenced by the project template's role-keyed bindings

## Capabilities

- Instantiates a typed project template into the configured PM work store, computing due dates back from the anchor date
- Ticks the project to completion: dispatches the worker agent bound to each ready task once its dependency, schedule, and claim gates pass
- Assigns approval tasks to humans and resumes downstream work when they are approved
- Recovers from a crashed tick idempotently — the dispatch ledger re-converges on the same child run instead of duplicating it
- Selects the PM work-store provider once at project instantiation (configured provider wins; auto-pick only when exactly one is installed; fails closed on none or several)
