# Agent guide

This repository builds a local test harness for backend and AI systems. Its web UI is a control plane for runs, traces, and evaluations. Browser, DOM, component, screenshot, and visual-regression testing are out of scope.

## Domain language

- **Project**: the host backend repository being tested.
- **Scenario**: concrete input and environment profile used to exercise a flow.
- **Flow**: production behavior under test, composed of observable steps.
- **Step**: one `ai`, `code`, `http`, or `database` operation.
- **Run**: one execution of a scenario.
- **Trace**: immutable evidence captured during a run.
- **Evaluation**: a deterministic or model-assisted judgment over a trace or value.
- **Verdict**: the aggregate run status: `passed`, `failed`, or `errored`.
- **Profile**: resource policy for mocked, recorded, integration, or live dependencies.

## Architectural rules

1. Test production entrypoints; never reproduce a production flow inside the harness.
2. Keep the runner deterministic. AI may help generate configuration, but a saved configuration must be enough to repeat a run.
3. Record evidence before presenting it. The CLI and web UI are projections over the same stored traces.
4. Keep provider, database, and HTTP integrations behind adapters.
5. Treat prompts, rendered variables, tool calls, schemas, latency, token usage, and side effects as trace data.
6. Never execute live writes or paid model calls unless the selected profile explicitly allows them.
7. Do not add frontend-testing concepts to the core domain. The dashboard is a product interface, not a test target.
8. Redact secrets before persisting trace data.

## Change expectations

- Add or update tests for runner, trace, persistence, and evaluation behavior.
- Document durable architectural decisions in `docs/adr/`.
- Prefer a complete vertical slice over disconnected framework scaffolding.
- Keep packages independently buildable and avoid circular dependencies.

## Agent skills

### Issue tracker

Issues and PRDs live in this repository's GitHub Issues. See
`docs/agents/issue-tracker.md`.

### Triage labels

Use the standard five-label triage vocabulary. See
`docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository with system-wide ADRs. See
`docs/agents/domain.md`.

