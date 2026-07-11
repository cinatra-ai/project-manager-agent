// Kind-gate acceptance: this repo AND the release-announcement pilot content
// pass the self-contained extension-kind-gate (the author-facing mirror of the
// host install pipeline), and a broken variant is refused.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const GATE = join(ROOT, "extension-kind-gate.mjs");

function runGate(packageRoot) {
  return spawnSync(process.execPath, [GATE, "--package-root", packageRoot], { encoding: "utf8" });
}

/** Synthesize the release-announcement package dir the pilot content defines:
 *  manifest + template + README + LICENSE, exactly what its own repo ships. */
function synthesizeReleaseAnnouncementPackage() {
  const dir = mkdtempSync(join(tmpdir(), "release-announcement-"));
  const pilot = join(ROOT, "templates", "release-announcement");
  cpSync(join(pilot, "package.json"), join(dir, "package.json"));
  cpSync(join(pilot, "README.md"), join(dir, "README.md"));
  cpSync(join(ROOT, "LICENSE"), join(dir, "LICENSE"));
  mkdirSync(join(dir, "cinatra"), { recursive: true });
  cpSync(join(pilot, "cinatra", "project-template.json"), join(dir, "cinatra", "project-template.json"));
  return dir;
}

test("this repo (the PM seat, no template sidecar) passes the agent kind gate", () => {
  const r = runGate(ROOT);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("the synthesized release-announcement package passes the agent kind gate", () => {
  const dir = synthesizeReleaseAnnouncementPackage();
  try {
    const r = runGate(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dropping the manifest dependency edge makes the gate REFUSE the template (one truth source)", () => {
  const dir = synthesizeReleaseAnnouncementPackage();
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

test("a structurally invalid template is refused at the gate, pre-publish", () => {
  const dir = synthesizeReleaseAnnouncementPackage();
  try {
    const tpl = JSON.parse(readFileSync(join(dir, "cinatra", "project-template.json"), "utf8"));
    tpl.tasks[0].dependsOn = ["announce"]; // kickoff <- announce: a cycle
    writeFileSync(join(dir, "cinatra", "project-template.json"), JSON.stringify(tpl, null, 2));
    const r = runGate(dir);
    assert.notEqual(r.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the PM seat manifest declares the pm-work-store capability at requirement required (the seat predicate)", () => {
  // Mirror of the host's agentManifestDeclaresPmSeat (src/lib/
  // project-template-resolve.ts): the seat is conferred ONLY by a REQUIRED
  // pm-work-store consumes entry; optional does not confer it.
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const consumes = pkg.cinatra?.consumes;
  assert.ok(Array.isArray(consumes), "cinatra.consumes must be an array");
  const seat = consumes.find((c) => c?.primitive === "pm-work-store");
  assert.ok(seat, "the PM agent must consume pm-work-store");
  assert.equal(seat.requirement, "required");
  // Provider-neutral BY DESIGN: no worker/provider edges on the generic agent.
  assert.deepEqual(pkg.cinatra.dependencies, []);
});
