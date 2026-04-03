# Contributing

Use Conventional Commits to make releases predictable.

Commit message examples and effects:

- `feat: add export to CSV` → minor bump (ex.: 0.1.0)
- `feature: add export to CSV` → mapped to `minor` (supported)
- `fix: correct typo` → patch bump
- `chore: update deps` → no feature bump
- `feat!: change API` or include `BREAKING CHANGE:` in the body → major bump

Important rules for this repository:

- Do NOT include CLI flags (like `--release-as`) in commit messages — flags are for the release tooling only.
- Avoid non-standard prefixes such as `.feat:`; use `feat:` or `feature:`.
- If you want to skip CI for a commit, include `[skip ci]` in the commit message.

Local checks and preview:

- Preview a release locally with:

```bash
npx standard-version --dry-run
```

- To run the full release locally (creates commit and tag):

```bash
npx standard-version
```

Notes about pre-1.0 versions:

- The CI/workflow is configured to detect `feat`/`feature` commits and will perform a minor release (0.0.x → 0.1.0) when appropriate.

Thank you for contributing — clear commit messages make releases reliable.
