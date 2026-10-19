# ai-testing-env

Local, trace-first testing for backend and AI workflows. Define typed Flows and
Scenarios, run them through explicit safety Profiles, persist redacted evidence,
and inspect or reevaluate the results from the CLI or Tilt dashboard.

The MVP targets Node.js 20 or newer. It tests AI calls, application code, HTTP
integrations, and database effects. It intentionally does not provide browser,
DOM, screenshot, CSS, or visual-regression testing.

## Install

```sh
pnpm add -D ai-testing-env \
  @ai-testing-env/adapter-ai \
  @ai-testing-env/adapter-http \
  @ai-testing-env/adapter-database
```

Preview deterministic discovery without executing Project code or writing files:

```sh
pnpm exec ai-test init
pnpm exec ai-test init --save .ai-test/discovery.json
```

Review the proposal, then create `.ai-test/config.ts`. A minimal Project is:

```ts
import { defineFlow, defineProject, defineScenario } from "ai-testing-env";

const flow = defineFlow({
  id: "answer",
  execute: (context, input: string) => context.step(
    { id: "normalize", kind: "code", input },
    () => input.trim(),
  ),
});

export default defineProject({
  id: "my-service",
  flows: [flow],
  scenarios: [defineScenario({
    id: "happy-path",
    flowId: flow.id,
    input: " test ",
    tags: ["smoke"],
  })],
});
```

Run one Scenario or a CI suite:

```sh
pnpm exec ai-test run happy-path
pnpm exec ai-test run --tag smoke --json
```

Exit codes are `0` for passed, `1` for failed Evaluations, and `2` for execution
or configuration errors. Every selected Scenario is persisted even when another
Scenario in the suite errors.

## Profiles and external effects

| Profile | Network | Write | Spend | Intended use |
| --- | ---: | ---: | ---: | --- |
| `mocked` | no | no | no | deterministic local and CI tests |
| `recorded` | no | no | no | fixture replay without external calls |
| `integration` | yes | no | no | read-only service integration |
| `live` | yes | yes | yes | explicitly authorized real effects |

Each Step declares the capabilities it requires. The runner checks them before
calling the operation. Live execution additionally requires both
`allowLive: true` in the Project and `--allow-live` on that invocation:

```sh
OPENAI_API_KEY="..." pnpm exec ai-test run live-answer \
  --profile live --allow-live
```

The OpenAI Responses adapter sends `store: false` and does not retry paid calls.
Use recording once under an authorized Profile, then replay fixtures under
`recorded` for routine development and CI.

## Reevaluation, queries, and comparison

Register deterministic or model-assisted Run Evaluations in the Project, then
apply selected rules without rerunning the Flow:

```sh
pnpm exec ai-test reevaluate <run-id> --evaluation output-contract
pnpm exec ai-test runs --flow answer --tag smoke --verdict passed --json
```

Reevaluation stores a new result linked through `sourceRunId`; the source Trace
is immutable. Model judges preserve rubric version, scale, threshold, score,
explanation, model, token usage, and errors. Recorded/replay judges repeat the
same judgment without another paid call.

## Dashboard with Tilt

From this repository, Tilt is the supported local server workflow:

```sh
pnpm install
tilt up
```

Open `http://127.0.0.1:4317`. Tilt loads the example Project and the shared
`.ai-test/runs` repository. The dashboard can launch Scenarios through the same
orchestrator and safety checks as the CLI, show pending/running/final state,
filter Runs, compare two compatible Traces, and launch reevaluation evidence.

For an installed Project, run the packaged server with a runs directory and
config path:

```sh
pnpm exec ai-test-dashboard .ai-test/runs .ai-test/config.ts
```

## Security

- Credentials belong in process environment variables, never Project config,
  prompts, fixtures, or committed Run JSON.
- Built-in redaction covers authorization headers, cookies, API keys, tokens,
  passwords, URL credentials, and sensitive query parameters. Add Project
  `redaction.sensitiveKeys` and `sensitiveValues` for domain secrets.
- CLI and dashboard persist already-redacted Traces; file storage repeats base
  redaction on write and read as defense in depth.
- `init` reads text files only. It does not import Project modules, execute
  scripts, follow symlinks, or perform network requests.
- Treat `integration` and `live` as access to real systems. Use narrowly scoped
  credentials and isolated resources with reliable cleanup.

## Troubleshooting

- **Configuration not found:** create `.ai-test/config.ts` or pass `--config`.
- **Profile does not allow capability:** select a suitable Profile or replace
  the adapter with mock/replay. Do not add permissions merely to silence a test.
- **Live execution requires authorization:** set Project `allowLive: true` and
  pass `--allow-live`; both are intentionally required.
- **Recorded fixture missing:** record the exact redacted request once, or fix
  request drift. Replay never falls back to a live call.
- **Dashboard is read-only:** start it with both the runs directory and Project
  config. Tilt in this repository already supplies both.
- **Invalid cursor:** restart the filtered query without the old cursor.

See [architecture](docs/architecture.md), [release checklist](docs/release-checklist.md),
and the [complete backend example](examples/basic-backend/README.md).
