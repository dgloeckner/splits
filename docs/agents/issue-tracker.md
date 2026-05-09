# Issue tracker: Local Markdown

Issues and PRDs for this repo live as markdown files in `.scratch/`. This repo has no git remote configured; there is no GitHub/GitLab tracker.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Related conventions in this repo

Long-lived feature specs and ADRs live under `specs/feat/` and `specs/adr/` (see `specs/README.md`). Those are durable design records, not triage tickets — keep `.scratch/` for in-flight issues and PRDs that haven't yet been promoted to a spec.
