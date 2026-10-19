# Basic backend example

From the repository root, build the workspace and run the configured Scenario:

```sh
pnpm build
pnpm --filter @ai-testing-env/example-basic-backend exec ai-test run publish-happy-path --runs-dir ../../.ai-test/runs
tilt up
```

The command executes the production `publishContent` entrypoint and writes its
Trace to the workspace `.ai-test/runs` repository. The dashboard started by
Tilt reads that same repository.
