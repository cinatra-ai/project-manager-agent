import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const flow = JSON.parse(readFileSync(new URL("../cinatra/oas.json", import.meta.url), "utf8"));
const start = flow.$referenced_components[flow.start_node.$component_ref];
const hasDefault = (input) => Object.hasOwn(input, "default");

// The install rule reads Flow defaults and the StartNode's required/hidden lists.
// Keep this package's declarations ready for that rule without importing the host.
function unresolvedVisibleInputs(candidate) {
  const node = candidate.$referenced_components[candidate.start_node.$component_ref];
  const { required = [], hidden = [] } = node.metadata?.cinatra ?? {};
  return candidate.inputs
    .filter((input) => !hidden.includes(input.title)
      && !required.includes(input.title) && !hasDefault(input))
    .map((input) => input.title);
}

test("every visible start input has a default or a required declaration", () => {
  assert.deepEqual(unresolvedVisibleInputs(flow), []);
  for (const input of flow.inputs) {
    const entry = start.inputs.find((item) => item.title === input.title);
    assert.ok(entry, `${input.title} reaches the start node`);
    assert.equal(entry.type, input.type);
    assert.equal(hasDefault(entry), hasDefault(input), `${input.title} default presence agrees`);
    assert.deepEqual(entry.default, input.default, `${input.title} default value agrees`);
    assert.equal(entry.description, input.description, `${input.title} setup explanation agrees`);
  }
});

test("as_of is an explicit required date with no implicit runtime date", () => {
  assert.ok(start.metadata.cinatra.required.includes("as_of"));
  const input = flow.inputs.find((item) => item.title === "as_of");
  assert.equal(hasDefault(input), false);
  assert.match(input.description, /YYYY-MM-DD/);
  assert.match(input.description, /date.*ready/i);
  const missing = structuredClone(flow);
  missing.$referenced_components.start.metadata.cinatra.required =
    start.metadata.cinatra.required.filter((title) => title !== "as_of");
  assert.ok(unresolvedVisibleInputs(missing).includes("as_of"));
});

for (const [title, argument] of [["configured_provider_id", "configuredProviderId"], ["project_id", "projectId"]]) {
  test(`${title} uses blank as omission, not as an invented machine identifier`, () => {
    assert.ok(!start.metadata.cinatra.required.includes(title));
    const input = flow.inputs.find((item) => item.title === title);
    assert.equal(input.default, "");
    assert.match(input.description, /Leave blank/);
    const prompt = flow.$referenced_components.instantiate.data.user;
    assert.ok(prompt.includes(`${argument}: {{ ${title} }} (omit the argument when blank)`));
    const edge = flow.data_flow_connections.find((entry) =>
      entry.destination_node.$component_ref === "instantiate" && entry.destination_input === title);
    assert.equal(edge.source_node.$component_ref, "start");
    assert.equal(edge.source_output, title);
    const missing = structuredClone(flow);
    delete missing.inputs.find((entry) => entry.title === title).default;
    assert.ok(unresolvedVisibleInputs(missing).includes(title));
  });
}

test("the original project identity, template and anchor date remain required without defaults", () => {
  for (const title of ["project_ref", "template_package", "anchor_date"]) {
    assert.ok(start.metadata.cinatra.required.includes(title));
    assert.equal(hasDefault(flow.inputs.find((input) => input.title === title)), false);
  }
});
