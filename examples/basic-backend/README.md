# Basic backend example

This Project exercises `code`, `ai`, `http`, and `database` Steps with
deterministic mocks and an ephemeral in-memory database. It never accesses live
resources by default.

From the repository root, build the workspace and run the configured Scenario:

```sh
pnpm build
pnpm --filter @ai-testing-env/example-basic-backend exec ai-test run publish-happy-path --runs-dir ../../.ai-test/runs
tilt up
```

The command executes the production `publishContent` entrypoint and writes its
Trace to the workspace `.ai-test/runs` repository. The dashboard started by
Tilt reads that same repository.

The CLI can also execute suites by Flow or tags and emit machine-readable
results for CI:

```sh
pnpm --filter @ai-testing-env/example-basic-backend exec ai-test run --flow publish-content --tag smoke --json
```

The persisted Trace contains the content transformation, normalized AI usage,
HTTP request/response evidence, and database setup/write/cleanup lifecycle.
