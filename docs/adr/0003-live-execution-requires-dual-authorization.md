# ADR 0003: Live execution requires dual authorization

## Status

Accepted

## Context

Live AI and infrastructure calls can send private data, mutate external systems,
and incur cost. Selecting a permissive Profile by mistake must not be enough to
perform one of those calls.

## Decision

A live operation requires all three checks to pass before its callback runs:

1. The Project configuration sets `allowLive: true`.
2. The invocation supplies `--allow-live` (or `allowLive: true` through the API).
3. The active Profile permits every capability declared by the Step.

The OpenAI adapter declares `network` and `spend`, disables provider-side
response storage, and performs no automatic retries. Callers can therefore
reason about the maximum number of paid requests from the number of executions.

## Consequences

Live runs require deliberate authorization in both versioned configuration and
the current command. Missing authorization produces an errored Trace before the
operation is called. Tests use injected transports; real credentials and paid
requests are never required by the normal test suite.
