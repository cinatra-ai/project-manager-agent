// Template-validation tests for the release-announcement pilot content.
//
// Validator: the repo's self-contained extension-kind-gate.mjs (refreshed from
// the cinatra-cli canonical copy), whose project-template rules mirror the
// AUTHORITATIVE host enforcers one-to-one (cinatra monorepo
// packages/sdk-extensions/src/project-template-contract.ts →
// validateProjectTemplate + checkTemplateWorkerRefsAgainstDependencies, wired
// by packages/agents/src/project-template-install-gate.ts). Zero @cinatra-ai
// imports, so this runs standalone in this repo's CI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateProjectTemplateObject,
  checkTemplateWorkerRefsAgainstManifest,
  PROJECT_TEMPLATE_FORMAT_VERSION,
} from "../extension-kind-gate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PILOT = join(HERE, "..", "templates", "release-announcement");

const loadTemplate = () =>
  JSON.parse(readFileSync(join(PILOT, "cinatra", "project-template.json"), "utf8"));
const loadManifest = () => JSON.parse(readFileSync(join(PILOT, "package.json"), "utf8"));

test("the release-announcement template is structurally valid", () => {
  assert.deepEqual(validateProjectTemplateObject(loadTemplate()), []);
});

test("template carries the exact contract format tag", () => {
  assert.equal(loadTemplate().formatVersion, PROJECT_TEMPLATE_FORMAT_VERSION);
});

test("worker refs exact-match the paired manifest's dependency edges (one truth source)", () => {
  const t = loadTemplate();
  const deps = loadManifest().cinatra.dependencies;
  assert.deepEqual(checkTemplateWorkerRefsAgainstManifest(t, deps), []);
});

test("the BPMN re-cut shape: four tasks, the exact dependency chain, the exact day offsets", () => {
  const t = loadTemplate();
  assert.equal(t.id, "release-announcement");
  assert.equal(t.anchor.id, "target");
  assert.deepEqual(
    t.tasks.map((x) => x.id),
    ["kickoff", "blog", "legal", "announce"],
  );
  const byId = new Map(t.tasks.map((x) => [x.id, x]));
  assert.deepEqual(byId.get("kickoff").dependsOn ?? [], []);
  assert.deepEqual(byId.get("blog").dependsOn, ["kickoff"]);
  assert.deepEqual(byId.get("legal").dependsOn, ["blog"]);
  assert.deepEqual(byId.get("announce").dependsOn, ["legal"]);
  // P14D/P7D/P3D before + PT1H after (day granularity) → -14/-7/-3/0.
  assert.equal(byId.get("kickoff").schedule.dueOffsetDays, -14);
  assert.equal(byId.get("blog").schedule.dueOffsetDays, -7);
  assert.equal(byId.get("legal").schedule.dueOffsetDays, -3);
  assert.equal(byId.get("announce").schedule.dueOffsetDays, 0);
  // Exactly ONE worker binding (the launch blog), role-keyed.
  const workers = t.tasks.filter((x) => x.worker);
  assert.equal(workers.length, 1);
  assert.equal(workers[0].worker.role, "launch-blog-writer");
  assert.equal(workers[0].worker.packageName, "@cinatra-ai/blog-pipeline-agent");
  // Exactly ONE approval gate (legal), organization-level.
  const approvals = t.tasks.filter((x) => x.approval);
  assert.deepEqual(approvals.map((x) => x.id), ["legal"]);
  assert.equal(approvals[0].approval.id, "legal-signoff");
});

test("a worker ref the manifest does not declare is refused (worker_not_in_dependencies)", () => {
  const t = loadTemplate();
  const errors = checkTemplateWorkerRefsAgainstManifest(t, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /worker_not_in_dependencies/);
});

test("a worker version drifting from the manifest edge is refused (worker_version_mismatch)", () => {
  const t = loadTemplate();
  const deps = structuredClone(loadManifest().cinatra.dependencies);
  deps[0].versionConstraint = { kind: "semver-range", range: "^9.9.9" };
  const errors = checkTemplateWorkerRefsAgainstManifest(t, deps);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /worker_version_mismatch/);
});

test("mutations the install gate must catch are caught (collect-ALL structural validation)", () => {
  // Wrong format tag.
  const bad1 = { ...loadTemplate(), formatVersion: "cinatra.ai/project-template@2" };
  assert.ok(validateProjectTemplateObject(bad1).some((e) => e.includes("bad_format_version")));

  // Unknown dependency edge.
  const bad2 = loadTemplate();
  bad2.tasks[1].dependsOn = ["no-such-task"];
  assert.ok(validateProjectTemplateObject(bad2).some((e) => e.includes("unknown_dependency")));

  // Dependency cycle.
  const bad3 = loadTemplate();
  bad3.tasks[0].dependsOn = ["announce"];
  assert.ok(validateProjectTemplateObject(bad3).length > 0);

  // Duplicate task id.
  const bad4 = loadTemplate();
  bad4.tasks[1].id = "kickoff";
  assert.ok(validateProjectTemplateObject(bad4).some((e) => e.includes("duplicate_task_id")));

  // due < start ordering violation.
  const bad5 = loadTemplate();
  bad5.tasks[0].schedule = { startOffsetDays: -3, dueOffsetDays: -14 };
  assert.ok(validateProjectTemplateObject(bad5).some((e) => e.includes("due_before_start")));

  // A task id with the natural-key path separator would corrupt ledger identity.
  const bad6 = loadTemplate();
  bad6.tasks[0].id = "kick/off";
  assert.ok(validateProjectTemplateObject(bad6).some((e) => e.includes("bad_task_id")));
});
