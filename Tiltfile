local_resource(
    "dashboard",
    serve_cmd='pnpm --filter @ai-testing-env/web dev "$PWD/.ai-test/runs" "$PWD/examples/basic-backend/.ai-test/config.ts"',
    deps=["packages/core/src", "packages/cli/src", "packages/web/src", "examples/basic-backend"],
    links=["http://127.0.0.1:4317"],
)
