// Template-validation + kind-gate-acceptance for the blog-content pilot content
// (the second W3 re-cut: the blog-content BPMN publish workflow -> a typed
// project template). Same shape as the release-announcement suites; validator is
// the repo's self-contained extension-kind-gate.mjs (the author-facing mirror of
// the host install enforcers project-template-contract.ts). Zero @cinatra-ai
// imports, so this runs standalone in this repo's CI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateProjectTemplateObject,
  checkTemplateWorkerRefsAgainstManifest,
  PROJECT_TEMPLATE_FORMAT_VERSION,
} from "../extension-kind-gate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PILOT = join(ROOT, "templates", "blog-content");
const GATE = join(ROOT, "extension-kind-gate.mjs");

const loadTemplate = () =>
  JSON.parse(readFileSync(join(PILOT, "cinatra", "project-template.json"), "utf8"));
const loadManifest = () => JSON.parse(readFileSync(join(PILOT, "package.json"), "utf8"));

function runGate(packageRoot) {
  return spawnSync(process.execPath, [GATE, "--package-root", packageRoot], { encoding: "utf8" });
}

/** Synthesize the blog-content package dir the pilot content defines: manifest +
 *  template + README + LICENSE, exactly what its own repo would ship. */
function synthesizeBlogContentPackage() {
  const dir = mkdtempSync(join(tmpdir(), "blog-content-"));
  cpSync(join(PILOT, "package.json"), join(dir, "package.json"));
  cpSync(join(PILOT, "README.md"), join(dir, "README.md"));
  cpSync(join(ROOT, "LICENSE"), join(dir, "LICENSE"));
  mkdirSync(join(dir, "cinatra"), { recursive: true });
  cpSync(join(PILOT, "cinatra", "project-template.json"), join(dir, "cinatra", "project-template.json"));
  return dir;
}

// ── Template validation ────────────────────────────────────────────────────

test("the blog-content template is structurally valid", () => {
  assert.deepEqual(validateProjectTemplateObject(loadTemplate()), []);
});

test("blog-content carries the exact contract format tag", () => {
  assert.equal(loadTemplate().formatVersion, PROJECT_TEMPLATE_FORMAT_VERSION);
});

test("blog-content worker refs exact-match the paired manifest's dependency edges (one truth source)", () => {
  const t = loadTemplate();
  const deps = loadManifest().cinatra.dependencies;
  assert.deepEqual(checkTemplateWorkerRefsAgainstManifest(t, deps), []);
});

test("the BPMN re-cut shape: four tasks, the exact dependency chain, no calendar schedule", () => {
  const t = loadTemplate();
  assert.equal(t.id, "blog-content");
  assert.equal(t.anchor.id, "target");
  assert.deepEqual(
    t.tasks.map((x) => x.id),
    ["review", "draft", "publish", "notify"],
  );
  const byId = new Map(t.tasks.map((x) => [x.id, x]));
  assert.deepEqual(byId.get("review").dependsOn ?? [], []);
  assert.deepEqual(byId.get("draft").dependsOn, ["review"]);
  assert.deepEqual(byId.get("publish").dependsOn, ["draft"]);
  assert.deepEqual(byId.get("notify").dependsOn, ["publish"]);
  // Event/dependency-gated, not calendar: no task carries a schedule.
  for (const task of t.tasks) assert.equal(task.schedule, undefined, `${task.id} must carry no schedule`);
  // Exactly ONE approval gate (review), organization-level, gating everything.
  const approvals = t.tasks.filter((x) => x.approval);
  assert.deepEqual(approvals.map((x) => x.id), ["review"]);
  assert.equal(approvals[0].approval.id, "publish-review");
  assert.equal(approvals[0].approval.assigneeRole, "organization");
  // Exactly ONE worker binding (the WordPress draft), role-keyed, BEHIND review.
  const workers = t.tasks.filter((x) => x.worker);
  assert.equal(workers.length, 1);
  assert.equal(workers[0].id, "draft");
  assert.equal(workers[0].worker.role, "wordpress-draft-writer");
  assert.equal(workers[0].worker.packageName, "@cinatra-ai/blog-wordpress-publish-agent");
  assert.deepEqual(workers[0].dependsOn, ["review"]);
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
  const bad1 = { ...loadTemplate(), formatVersion: "cinatra.ai/project-template@2" };
  assert.ok(validateProjectTemplateObject(bad1).some((e) => e.includes("bad_format_version")));

  const bad2 = loadTemplate();
  bad2.tasks[1].dependsOn = ["no-such-task"];
  assert.ok(validateProjectTemplateObject(bad2).some((e) => e.includes("unknown_dependency")));

  const bad3 = loadTemplate();
  bad3.tasks[0].dependsOn = ["notify"]; // review <- notify: a cycle
  assert.ok(validateProjectTemplateObject(bad3).length > 0);

  const bad4 = loadTemplate();
  bad4.tasks[1].id = "review"; // duplicate id
  assert.ok(validateProjectTemplateObject(bad4).some((e) => e.includes("duplicate_task_id")));

  const bad5 = loadTemplate();
  bad5.tasks[0].id = "rev/iew"; // natural-key path separator
  assert.ok(validateProjectTemplateObject(bad5).some((e) => e.includes("bad_task_id")));
});

// ── Kind-gate acceptance ───────────────────────────────────────────────────

test("the synthesized blog-content package passes the agent kind gate", () => {
  const dir = synthesizeBlogContentPackage();
  try {
    const r = runGate(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dropping the manifest dependency edge makes the gate REFUSE the template (one truth source)", () => {
  const dir = synthesizeBlogContentPackage();
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    pkg.cinatra.dependencies = [];
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
    const r = runGate(dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /worker_not_in_dependencies/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a structurally invalid blog-content template is refused at the gate, pre-publish", () => {
  const dir = synthesizeBlogContentPackage();
  try {
    const tpl = JSON.parse(readFileSync(join(dir, "cinatra", "project-template.json"), "utf8"));
    tpl.tasks[0].dependsOn = ["notify"]; // review <- notify: a cycle
    writeFileSync(join(dir, "cinatra", "project-template.json"), JSON.stringify(tpl, null, 2));
    const r = runGate(dir);
    assert.notEqual(r.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
