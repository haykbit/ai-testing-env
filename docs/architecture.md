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
that can permit all three. A live Step with external capabilities runs only when
the Project sets `allowLive: true` and the current invocation also passes
`--allow-live`. Either missing authorization blocks the operation before it can
access the network.

## Trace redaction

Redaction happens before a completed Trace reaches any RunRepository. Built-in
rules protect common credential keys such as authorization headers, cookies,
API keys, tokens, passwords, and secrets. A Project can add sensitive keys and
literal values without disabling the base rules. URL credentials and sensitive
query parameters are redacted as part of the same recursive pass.

FileRunRepository repeats the base redaction on write and read as defense in
depth, including for legacy files. CLI, API, and dashboard therefore consume
the already-redacted evidence rather than hiding secrets only at presentation
time.

## AI adapter evidence and replay

`@ai-testing-env/adapter-ai` defines the provider-independent AI request and
response contract. `runAiStep` records model, rendered prompt, messages, tools,
response schema, provider, adapter mode, output, tool calls, latency, and token
usage through a normal `ai` Step.

Mocks have no external capabilities. Recording wraps another adapter and saves
a redacted fixture under a stable SHA-256 key derived from the canonical,
redacted request. Replay reads that fixture without invoking an external
transport. Missing and corrupt fixtures fail with dedicated, actionable errors.

### OpenAI live provider

`OpenAIResponsesAdapter` implements the common AI port with the OpenAI Responses
API. It records normalized text, structured output, tool calls, latency, token
usage, and provider response id. Requests set `store: false`, do not retry, and
never put the API key in Step input or output.

Configure credentials in the process environment and opt in at both levels:

```sh
export OPENAI_API_KEY="..."
ai-test run live-answer --profile live --allow-live
```

The Project must also contain `allowLive: true`. Treat live runs as paid,
networked execution: scope credentials narrowly, keep them out of source and
fixtures, and use mocked or replayed adapters for routine local and CI tests.

## HTTP adapter evidence and replay

`@ai-testing-env/adapter-http` exposes one HTTP port for mocked, recorded,
replayed, and integration execution. Mock and replay have no external
capabilities. The fetch-backed integration adapter declares `network`, so the
runner checks the active Profile before opening a connection.

HTTP Steps capture method, redacted URL, allowlisted request and response
headers, body, status, and duration in the normal Trace. Recorded fixtures use a
stable key derived from the canonical redacted request; replay performs no
network access. Non-2xx statuses remain observable responses, while transport,
invalid JSON, and missing-fixture failures become Step errors.

## Database effects and cleanup

`@ai-testing-env/adapter-database` wraps a database driver without exposing its
connection object in a Trace. `withDatabaseResource` records setup and cleanup
as lifecycle Steps and guarantees cleanup through `finally`, including when the
tested Flow throws. If both the Flow and cleanup fail, the Run retains a combined
error and the cleanup Step retains its own error evidence.

Operations explicitly declare `read` or `write`. Integration reads require the
adapter's base capabilities (normally `network`); writes additionally require
`write` and are blocked before the driver is invoked when the Profile denies it.
Traces contain the operation name, statement and redacted parameters, duration,
rows, and rows affected, while the private resource and credentials stay inside
the adapter.

## Deterministic reevaluation

A Project can register deterministic Run Evaluations by id. `ai-test reevaluate`
loads an immutable clone of a stored Trace, applies only the selected
Evaluations, and saves a new Run-shaped result with `sourceRunId`. It never
resolves a Flow or invokes a Step or adapter.

The source JSON remains unchanged. The reevaluation contains no Steps, retains
the source Project/Profile/Flow/Scenario identity, and stores its new Verdict and
evidence through the same redaction and repository boundary. The API includes
`sourceRunId` in summaries and the dashboard links each reevaluation back to its
source Run.

