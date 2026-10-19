# Architecture

`ai-testing-env` is a trace-first local test harness for backend and AI workflows.

```text
Host project entrypoint
        |
        v
   Core runner ----> adapters (AI / HTTP / database / code)
        |
        v
 immutable run traces ----> evaluators
        |                       |
        +-----------+-----------+
                    v
              run repository
               /          \
             CLI       local web UI
```

The first vertical slice is intentionally small:

1. A project declares flows and scenarios in `.ai-test/config.ts`.
2. The runner executes production code through an explicitly instrumented flow.
3. Every step emits an immutable trace.
4. Evaluators attach evidence and determine the verdict.
5. Runs are stored as local JSON.
6. The CLI and dashboard read the same repository.

## Product boundary

Supported test targets:

- model prompts and structured outputs;
- backend functions and business workflows;
- HTTP APIs and service integrations;
- database setup, queries, side effects, and cleanup;
- end-to-end combinations of the above.

Explicitly unsupported targets:

- DOM and component tests;
- browser automation;
- screenshots and visual regression;
- CSS and client-side interaction assertions.

## Planned layers

- `@ai-testing-env/core`: domain model, runner, evaluators, and run storage.
- `@ai-testing-env/web`: read-only local dashboard and HTTP API. The dashboard
  renders directly from `RunRepository`, so it never needs to execute a flow or
  inspect hidden runner state.
- `ai-testing-env`: installable CLI and configuration loader.
- adapters: provider and infrastructure-specific instrumentation added as separate packages when needed.

## Configuration discovery

Initialization has two stages. A deterministic scanner inventories languages, model SDKs, prompts, schemas, endpoints, database clients, and existing test tools. An optional agent then turns that inventory into a proposed configuration. The proposal is reviewed and saved; normal test runs do not require project rediscovery.

## Local dashboard

Tilt owns the local development server and watches the core and web sources.
Run it from the workspace root:

```sh
tilt up
```

The dashboard reads `.ai-test/runs`, binds to `127.0.0.1:4317`, and exposes both
the HTML dashboard and a read-only API:

- `GET /api/runs` returns compact run summaries.
- `GET /api/runs/:id` returns one complete stored trace.

## Execution Profiles

Every Run uses a named Profile. Built-in Profiles are `mocked`, `recorded`,
`integration`, and `live`. Steps declare the capabilities they require:
`network`, `write`, or `spend`. The runner checks those capabilities before it
invokes the Step operation and records a policy error in the Trace when the
Profile denies them.

`mocked` and `recorded` deny all external capabilities. `integration` permits
network access but denies writes and spend. `live` is the only built-in Profile
that can permit all three; provider-specific live operations add their own
explicit authorization requirements.

