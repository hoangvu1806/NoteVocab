# Contributing to LexiNote

Thank you for contributing.

## Workflow

1. Fork the repository and create a focused branch from `main`.
2. Install dependencies with `npm ci`.
3. Make a small, documented change.
4. Run the checks below.
5. Open a pull request describing the problem, solution, and manual testing.

```powershell
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
```

Do not commit `node_modules`, `dist`, `src-tauri/target`, installers, user vocabulary files, credentials, or API keys.

By contributing, you agree that your contribution is licensed under the MIT License.
