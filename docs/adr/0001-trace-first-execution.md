# ADR 0001: Trace-first execution

Status: accepted

## Decision

The durable output of every run is an immutable trace. Evaluations reference captured evidence rather than hidden runner state. The CLI and web UI are projections over the same run repository.

## Consequences

- Failed runs remain inspectable.
- Evaluators can be rerun against recorded evidence.
- Reports do not need to execute production code again.
- Trace redaction and schema evolution are core responsibilities.

