# Release checklist

## Correctness

- [ ] `pnpm check` passes typecheck, all tests, builds, and package smoke.
- [ ] `tilt ci --timeout=20s --port=0` reports the dashboard healthy.
- [ ] The clean-install smoke runs the packaged binary and records `ai`, `code`,
      `http`, and `database` Steps without live resources.
- [ ] Package engines require Node.js 20 or newer.

## Package contents

- [ ] Every tarball contains `package.json`, README/license when applicable, and
      compiled `dist` files only.
- [ ] No `src`, tests, source maps, coverage, `.ai-test`, fixtures, logs,
      editor files, or dependency directories are present.
- [ ] Tarball package manifests expose compiled JavaScript and declarations.
- [ ] Workspace dependency ranges are converted to release versions.

## Security

- [ ] Search tracked files and tarball listings for API keys, bearer tokens,
      cookies, passwords, private keys, and known test secrets.
- [ ] No Run JSON or recorded fixture is included in a package.
- [ ] Live examples require explicit Project and invocation authorization.
- [ ] The default example uses only mocks and local in-memory resources.
- [ ] OpenAI requests keep provider storage disabled and no paid-call retry.

## Documentation

- [ ] Installation, configuration, Profiles, CI exit codes, Tilt, redaction,
      live authorization, reevaluation, and troubleshooting are current.
- [ ] Example commands work from a clean checkout.
- [ ] Version and changelog/release notes identify any schema compatibility
      constraints.
