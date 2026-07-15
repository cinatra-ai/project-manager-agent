// Test entry point. A positional script (not `node --test`) so a runner that
// appends flags to `pnpm test` (npm's --if-present convention) hands them to
// THIS file's argv instead of tripping node's option parser. node:test
// executes the imported suites and fails the process on any failure.
import "./template-validation.test.mjs";
import "./tick-shell-contract.test.mjs";
import "./kind-gate-acceptance.test.mjs";
import "./blog-content.test.mjs";
