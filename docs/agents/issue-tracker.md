# Issue tracker: GitHub

Issues and PRDs for this repository live as GitHub issues. Use the `gh` CLI for
all operations and infer the repository from the `origin` remote.

## Conventions

- Create an issue with `gh issue create --title "..." --body-file <path>`.
- Read an issue and its discussion with `gh issue view <number> --comments`.
- List issues with `gh issue list` and request JSON fields when filtering or
  processing results.
- Comment with `gh issue comment <number> --body "..."`.
- Add or remove labels with `gh issue edit`.
- Close an issue with `gh issue close`, including a closing comment when useful.

When a skill says to publish something to the issue tracker, create a GitHub
issue in `haykbit/ai-testing-env`.
