# AgentsTookitProjects

This repository contains sample projects for exploring and testing the
capabilities exposed by the Microsoft 365 Agents SDK using the Microsoft 365
Agents Toolkit extension for Visual Studio Code.

Projects may use TypeScript, Python, or .NET.

## Git preparation

Run from this folder, before initializing Git or creating the GitHub repository.
Authenticate with `gh auth login` if needed; the repository will belong to the
authenticated GitHub account.

```bash
PROJECT="$(basename "$PWD")" &&
git init . -q -b main &&
git config --local user.email "mauro.minella@microsoft.com" &&
git config --local user.name "Mauro Minella" &&
git add . &&
git commit -m "first commit" &&
gh repo create "$PROJECT" --public --source . --push \
  --description "Sample projects testing Microsoft 365 Agents SDK capabilities with the Microsoft 365 Agents Toolkit extension for VS Code."
```

From the repository root, `git add .` and `git add -A` both stage additions,
modifications, and deletions. From a subfolder, `git add .` only stages that
subfolder, while `git add -A` stages the entire repository.

The shared [.gitignore](.gitignore) excludes dependencies, build outputs, local
Toolkit state, and `.env*.user` files for TypeScript, Python, and .NET projects.
Environment files without the `.user` suffix remain eligible for version control:
check that they contain no secrets before committing to this public repository.