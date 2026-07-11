// Tick-shell contract tests: the OAS flow drives the host project primitives
// with EXACTLY the agent-suppliable arguments — and the deterministic tick
// policy holds against test doubles of the dispatch primitive.
//
// MIRROR NOTE (kept in lockstep by review, the extension-kind-gate convention):
// the pinned field lists and the doubles below mirror the AUTHORITATIVE host
// contracts in the cinatra monorepo —
//   - src/lib/project-instantiation.ts   (ProjectInstantiationInput)
//   - src/lib/project-dispatch.ts        (ProjectWorkerDispatchInput,
//     ProjectDispatchOutcome, and the deterministic policy layer its unit
//     tests prove: pick ∈ ready set, role = template binding, worker
//     allowlisted, ledger idempotency by (item, actionVersion))
//   - packages/sdk-extensions/src/project-template-contract.ts (readyItems /
//     itemNotReadyReason, composeWorkItemNaturalKey, computeAbsoluteDate)
// This repo cannot import those (host-internal, monorepo-only), so the
// doubles restate them — byte-faithful where the semantics are load-bearing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const oas = JSON.parse(readFileSync(join(ROOT, "cinatra", "oas.json"), "utf8"));
const skill = readFileSync(join(ROOT, "skills", "project-manager-agent", "SKILL.md"), "utf8");
const template = JSON.parse(
  readFileSync(join(ROOT, "templates", "release-announcement", "cinatra", "project-template.json"), "utf8"),
);
const pilotManifest = JSON.parse(
  readFileSync(join(ROOT, "templates", "release-announcement", "package.json"), "utf8"),
);

// --- the pinned host-contract mirrors ---------------------------------------

// The project_instantiate TOOL composes TWO host pieces: (1)
// ProjectInstantiationInput (src/lib/project-instantiation.ts) — orgId and
// the PM seat are HOST-derived (auth + run identity); projectRef,
// templatePackage, projectId, configuredProviderId are agent-suppliable; the
// primitive itself takes NO date — plus (2) deterministic materialization
// (MaterializeOptions.anchorDate in the sdk-extensions template contract),
// which is where anchorDate goes.
const INSTANTIATE_AGENT_SUPPLIED = ["projectRef", "templatePackage", "anchorDate", "projectId", "configuredProviderId"];
const INSTANTIATE_HOST_DERIVED = ["orgId", "pmAgentPackage"];

// ProjectWorkerDispatchInput (src/lib/project-dispatch.ts): items, the lease,
// and the parent tick run are HOST-derived (the caller-crafted-ceiling /
// clone-copy trap); runBy is host-attached delegated attribution.
const DISPATCH_AGENT_SUPPLIED = ["projectRef", "pick", "role", "asOf", "actionVersion", "runInput"];
const DISPATCH_HOST_DERIVED = ["orgId", "items", "lease", "parentRunId"];
const DISPATCH_FULL_INPUT = [...DISPATCH_AGENT_SUPPLIED, ...DISPATCH_HOST_DERIVED, "runBy"];

// Trust operands an agent must NEVER supply, on any tool.
const FORBIDDEN_AGENT_FIELDS = ["orgId", "pmAgentPackage", "items", "lease", "parentRunId"];

// --- OAS flow shape ----------------------------------------------------------

test("flow is the thin tick-shell: start -> instantiate -> tick -> end", () => {
  const edges = oas.control_flow_connections.map(
    (e) => `${e.from_node.$component_ref}->${e.to_node.$component_ref}`,
  );
  assert.deepEqual(edges, ["start->instantiate", "instantiate->tick", "tick->end"]);
  assert.deepEqual(
    oas.nodes.map((n) => n.$component_ref),
    ["start", "instantiate", "tick", "end"],
  );
});

test("the OAS declares the three host tools with EXACTLY the pinned agent-supplied fields", () => {
  const tools = oas.metadata.cinatra.projectPrimitiveTools;
  assert.deepEqual(tools.project_instantiate.agentSupplied, INSTANTIATE_AGENT_SUPPLIED);
  assert.deepEqual(tools.project_instantiate.hostDerived, INSTANTIATE_HOST_DERIVED);
  assert.deepEqual(tools.project_dispatch_worker.agentSupplied, DISPATCH_AGENT_SUPPLIED);
  assert.deepEqual(tools.project_dispatch_worker.hostDerived, DISPATCH_HOST_DERIVED);
  assert.deepEqual(tools.project_tick_context.agentSupplied, ["projectRef", "asOf"]);

  // agentSupplied ∪ hostDerived stays inside the primitive's full input
  // contract, and the two sets are disjoint (no field is both).
  for (const [agent, host, full] of [
    [INSTANTIATE_AGENT_SUPPLIED, INSTANTIATE_HOST_DERIVED, [...INSTANTIATE_AGENT_SUPPLIED, ...INSTANTIATE_HOST_DERIVED]],
    [DISPATCH_AGENT_SUPPLIED, DISPATCH_HOST_DERIVED, DISPATCH_FULL_INPUT],
  ]) {
    for (const f of [...agent, ...host]) assert.ok(full.includes(f), `${f} outside the primitive contract`);
    for (const f of agent) assert.ok(!host.includes(f), `${f} in both agentSupplied and hostDerived`);
  }

  // Trust operands are never agent-suppliable on ANY declared tool.
  for (const [name, decl] of Object.entries(tools)) {
    if (name === "description") continue;
    for (const f of FORBIDDEN_AGENT_FIELDS) {
      assert.ok(!decl.agentSupplied.includes(f), `${name} lets the agent supply trust operand ${f}`);
    }
  }
});

test("dispatch outcomes in the OAS match the primitive's outcome statuses", () => {
  const tools = oas.metadata.cinatra.projectPrimitiveTools;
  assert.deepEqual(tools.project_dispatch_worker.outcomes, [
    "dispatched",
    "already_dispatched",
    "rejected",
    "failed",
  ]);
  assert.deepEqual(tools.project_instantiate.outcomes, [
    "instantiated",
    "already_instantiated",
    "rejected",
    "failed",
  ]);
});

test("each phase node names only tools the OAS contract declares, and SKILL.md documents every tool", () => {
  const declared = new Set(
    Object.keys(oas.metadata.cinatra.projectPrimitiveTools).filter((k) => k !== "description"),
  );
  const rc = oas.$referenced_components;
  assert.deepEqual(rc.instantiate.metadata.cinatra.tools, ["project_instantiate"]);
  assert.deepEqual(rc.tick.metadata.cinatra.tools, ["project_tick_context", "project_dispatch_worker"]);
  for (const node of ["instantiate", "tick"]) {
    for (const t of rc[node].metadata.cinatra.tools) {
      assert.ok(declared.has(t), `${node} names undeclared tool ${t}`);
    }
  }
  for (const t of declared) {
    assert.ok(skill.includes("`" + t + "`"), `SKILL.md does not document ${t}`);
  }
  // The behavior doc must forbid the trust operands by name.
  for (const f of FORBIDDEN_AGENT_FIELDS) {
    assert.ok(skill.includes("`" + f + "`"), `SKILL.md does not name forbidden operand ${f}`);
  }
});

// --- deterministic mirrors (readiness + materialization) ---------------------

const SEP = "/";
const key = (projectRef, taskId) => `${projectRef}${SEP}${taskId}`;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function computeAbsoluteDate(anchorDate, offsetDays) {
  const base = Date.parse(`${anchorDate}T00:00:00Z`);
  return new Date(base + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

// Mirror of itemNotReadyReason (fixed gate priority) + readyItems.
const PICKABLE = new Set(["backlog", "todo"]);
function itemNotReadyReason(item, ctx) {
  if (!YMD.test(ctx.asOf)) throw new Error(`asOf must be YYYY-MM-DD, got "${ctx.asOf}"`);
  if (!PICKABLE.has(item.status)) return "not_pickable_status";
  if ((item.assigneeIds?.length ?? 0) > 0) return "claimed";
  for (const dep of item.dependsOn ?? []) {
    if (ctx.statusByKey.get(dep) !== "done") return "deps_unmet";
  }
  if (item.startDate != null && item.startDate.slice(0, 10) > ctx.asOf) return "not_yet_started";
  return null;
}
function readyItems(items, asOf) {
  const statusByKey = new Map(items.map((it) => [it.naturalKey, it.status]));
  return items.filter((it) => itemNotReadyReason(it, { asOf, statusByKey }) === null);
}

// Mirror of materializeProjectTemplate (the fields the tick needs).
function materialize(tpl, { projectRef, anchorDate }) {
  return tpl.tasks.map((task) => ({
    taskId: task.id,
    worker: task.worker ?? null,
    requiresApproval: task.approval != null,
    naturalKey: key(projectRef, task.id),
    status: "backlog",
    startDate:
      task.schedule?.startOffsetDays == null ? null : computeAbsoluteDate(anchorDate, task.schedule.startOffsetDays),
    dueDate:
      task.schedule?.dueOffsetDays == null ? null : computeAbsoluteDate(anchorDate, task.schedule.dueOffsetDays),
    dependsOn: (task.dependsOn ?? []).map((d) => key(projectRef, d)),
    assigneeIds: [],
  }));
}

// --- the dispatch-primitive test double --------------------------------------
// Mirrors the deterministic policy layer the primitive's own unit tests prove:
// a pick or worker failing the validators NEVER reaches run creation; the
// ledger short-circuits a repeat (item, actionVersion) onto the same child run.
function makeDispatchDouble(tpl, manifestDeps, items) {
  const ledger = new Map(); // `${pick}@${actionVersion}` -> runId
  const taskByKey = new Map(items.map((it) => [it.naturalKey, it]));
  const allowlist = new Map(); // role -> workerRef
  for (const t of tpl.tasks) if (t.worker) allowlist.set(t.worker.role, t.worker);
  const depByPackage = new Map(manifestDeps.map((d) => [d.packageName, d]));
  let seq = 0;

  return function dispatchProjectWorkerDouble(input) {
    for (const f of FORBIDDEN_AGENT_FIELDS) {
      if (f in input) return { status: "rejected", code: "INVALID_INPUT", message: `agent-supplied trust operand ${f}` };
    }
    if (!Number.isSafeInteger(input.actionVersion) || input.actionVersion < 0) {
      return { status: "rejected", code: "INVALID_INPUT", message: "bad actionVersion" };
    }
    if (!YMD.test(input.asOf)) return { status: "rejected", code: "INVALID_INPUT", message: "bad asOf" };
    const item = taskByKey.get(input.pick);
    if (!item) return { status: "rejected", code: "PICK_UNKNOWN", message: input.pick };
    const ready = new Set(readyItems(items, input.asOf).map((it) => it.naturalKey));
    if (!ready.has(input.pick)) {
      const statusByKey = new Map(items.map((it) => [it.naturalKey, it.status]));
      return {
        status: "rejected",
        code: "ITEM_NOT_READY",
        notReadyReason: itemNotReadyReason(item, { asOf: input.asOf, statusByKey }),
        message: input.pick,
      };
    }
    const binding = allowlist.get(input.role);
    if (!binding || !item.worker || item.worker.role !== input.role) {
      return { status: "rejected", code: "WORKER_NOT_ALLOWLISTED", message: input.role };
    }
    const edge = depByPackage.get(binding.packageName);
    if (
      !edge ||
      edge.versionConstraint.kind !== binding.versionConstraint.kind ||
      edge.versionConstraint.range !== binding.versionConstraint.range
    ) {
      return { status: "rejected", code: "TEMPLATE_WORKER_REFS_INVALID", message: binding.packageName };
    }
    const ledgerKey = `${input.pick}@${input.actionVersion}`;
    if (ledger.has(ledgerKey)) {
      return { status: "already_dispatched", runId: ledger.get(ledgerKey), attemptId: ledgerKey };
    }
    const runId = `run-${++seq}`;
    ledger.set(ledgerKey, runId);
    return { status: "dispatched", runId, attemptId: ledgerKey, idempotencyKey: ledgerKey };
  };
}

// The tick-shell's deterministic pick policy (what the TICK recipe encodes):
// dispatch every ready item whose template task binds a worker role; ready
// human/approval items are surfaced, never dispatched.
function tickShellPlan(tpl, items, asOf) {
  const ready = readyItems(items, asOf);
  const workerByKey = new Map(items.map((it) => [it.naturalKey, it.worker]));
  return {
    dispatches: ready
      .filter((it) => workerByKey.get(it.naturalKey))
      .map((it) => ({ pick: it.naturalKey, role: workerByKey.get(it.naturalKey).role })),
    waitingOnHuman: ready.filter((it) => !workerByKey.get(it.naturalKey)).map((it) => it.naturalKey),
  };
}

// --- lifecycle: the release-announcement template through the tick shell -----

const PROJECT_REF = "acme-launch";
const ANCHOR = "2026-08-01";
const DEPS = pilotManifest.cinatra.dependencies;

test("materialization: anchor-relative dates and anchor-independent natural keys", () => {
  const items = materialize(template, { projectRef: PROJECT_REF, anchorDate: ANCHOR });
  const byId = new Map(items.map((it) => [it.taskId, it]));
  assert.equal(byId.get("kickoff").dueDate, "2026-07-18"); // -14
  assert.equal(byId.get("blog").dueDate, "2026-07-25"); // -7
  assert.equal(byId.get("legal").dueDate, "2026-07-29"); // -3
  assert.equal(byId.get("announce").dueDate, "2026-08-01"); // 0
  // Re-materializing with a moved anchor lands on the SAME keys (repair rule).
  const moved = materialize(template, { projectRef: PROJECT_REF, anchorDate: "2026-09-01" });
  assert.deepEqual(moved.map((i) => i.naturalKey), items.map((i) => i.naturalKey));
  assert.equal(moved[0].dueDate, "2026-08-18");
});

test("tick 1: only kickoff is ready; it is human work, nothing dispatches", () => {
  const items = materialize(template, { projectRef: PROJECT_REF, anchorDate: ANCHOR });
  const plan = tickShellPlan(template, items, "2026-07-18");
  assert.deepEqual(plan.dispatches, []);
  assert.deepEqual(plan.waitingOnHuman, [key(PROJECT_REF, "kickoff")]);
});

test("tick 2: kickoff done -> blog ready -> dispatched through the role binding; ledger replay converges", () => {
  const items = materialize(template, { projectRef: PROJECT_REF, anchorDate: ANCHOR });
  items.find((i) => i.taskId === "kickoff").status = "done";
  const dispatch = makeDispatchDouble(template, DEPS, items);
  const plan = tickShellPlan(template, items, "2026-07-25");
  assert.deepEqual(plan.dispatches, [{ pick: key(PROJECT_REF, "blog"), role: "launch-blog-writer" }]);
  assert.deepEqual(plan.waitingOnHuman, []);

  const first = dispatch({
    projectRef: PROJECT_REF,
    pick: key(PROJECT_REF, "blog"),
    role: "launch-blog-writer",
    asOf: "2026-07-25",
    actionVersion: 0,
    runInput: { brief: "Draft the launch blog post" },
  });
  assert.equal(first.status, "dispatched");

  // Crash-recovery: SAME (item, actionVersion) converges on the SAME child run.
  const replay = dispatch({
    projectRef: PROJECT_REF,
    pick: key(PROJECT_REF, "blog"),
    role: "launch-blog-writer",
    asOf: "2026-07-25",
    actionVersion: 0,
    runInput: { brief: "Draft the launch blog post" },
  });
  assert.equal(replay.status, "already_dispatched");
  assert.equal(replay.runId, first.runId);
});

test("the deterministic validators refuse what prose must never force through", () => {
  const items = materialize(template, { projectRef: PROJECT_REF, anchorDate: ANCHOR });
  items.find((i) => i.taskId === "kickoff").status = "done";
  const dispatch = makeDispatchDouble(template, DEPS, items);
  const base = {
    projectRef: PROJECT_REF,
    pick: key(PROJECT_REF, "blog"),
    role: "launch-blog-writer",
    asOf: "2026-07-25",
    actionVersion: 0,
    runInput: {},
  };

  // A pick outside the ready set (legal is dep-gated behind blog).
  const notReady = dispatch({ ...base, pick: key(PROJECT_REF, "legal") });
  assert.equal(notReady.status, "rejected");
  assert.equal(notReady.code, "ITEM_NOT_READY");
  assert.equal(notReady.notReadyReason, "deps_unmet");

  // A hallucinated pick.
  assert.equal(dispatch({ ...base, pick: key(PROJECT_REF, "nope") }).code, "PICK_UNKNOWN");

  // A role that is not the template task's binding.
  assert.equal(dispatch({ ...base, role: "draft-writer" }).code, "WORKER_NOT_ALLOWLISTED");

  // A claimed item is not ready.
  const claimedItems = materialize(template, { projectRef: PROJECT_REF, anchorDate: ANCHOR });
  claimedItems.find((i) => i.taskId === "kickoff").status = "done";
  claimedItems.find((i) => i.taskId === "blog").assigneeIds = ["someone"];
  const dispatch2 = makeDispatchDouble(template, DEPS, claimedItems);
  const claimed = dispatch2(base);
  assert.equal(claimed.code, "ITEM_NOT_READY");
  assert.equal(claimed.notReadyReason, "claimed");

  // Agent-supplied trust operands are refused outright.
  assert.equal(dispatch({ ...base, lease: { holderId: "x", version: 1 } }).code, "INVALID_INPUT");
  assert.equal(dispatch({ ...base, orgId: "org_1" }).code, "INVALID_INPUT");
  assert.equal(dispatch({ ...base, parentRunId: "run-x" }).code, "INVALID_INPUT");

  // A template/manifest drift is refused (one truth source).
  const driftedDeps = structuredClone(DEPS);
  driftedDeps[0].versionConstraint = { kind: "semver-range", range: "^2.0.0" };
  const dispatch3 = makeDispatchDouble(template, driftedDeps, items);
  assert.equal(dispatch3(base).code, "TEMPLATE_WORKER_REFS_INVALID");
});

test("approval blocks the chain: announce never becomes ready before legal is done", () => {
  const items = materialize(template, { projectRef: PROJECT_REF, anchorDate: ANCHOR });
  items.find((i) => i.taskId === "kickoff").status = "done";
  items.find((i) => i.taskId === "blog").status = "done";

  // Legal (the approval gate) is ready human work; announce is dep-gated.
  let plan = tickShellPlan(template, items, "2026-07-29");
  assert.deepEqual(plan.dispatches, []);
  assert.deepEqual(plan.waitingOnHuman, [key(PROJECT_REF, "legal")]);

  // A cancelled blocker does NOT satisfy the edge (never silently satisfied).
  items.find((i) => i.taskId === "legal").status = "cancelled";
  plan = tickShellPlan(template, items, "2026-08-01");
  assert.deepEqual(plan.waitingOnHuman, []);
  assert.deepEqual(plan.dispatches, []);

  // Only a DONE legal unblocks announce.
  items.find((i) => i.taskId === "legal").status = "done";
  plan = tickShellPlan(template, items, "2026-08-01");
  assert.deepEqual(plan.waitingOnHuman, [key(PROJECT_REF, "announce")]);
  assert.deepEqual(plan.dispatches, []);
});
