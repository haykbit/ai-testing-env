local_resource(
    "dashboard",
    serve_cmd="pnpm --filter @ai-testing-env/web dev -- .ai-test/runs",
    deps=["packages/core/src", "packages/web/src"],
    links=["http://127.0.0.1:4317"],
)
