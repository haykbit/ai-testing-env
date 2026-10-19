# ADR 0002: The dashboard is not a test target

Status: accepted

## Decision

The product includes a local web dashboard for controlling and inspecting backend and AI tests. The testing domain does not include browser, DOM, component, screenshot, or visual-regression steps.

## Consequences

- Core step kinds stay focused on `ai`, `code`, `http`, and `database`.
- Dashboard implementation details do not leak into flow definitions.
- A headless CLI remains fully functional for automation and CI.

