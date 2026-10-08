# Dots cloud tasks

This workflow runs on GitHub-hosted Ubuntu machines. Once a task starts, your
laptop can be closed. Submit another task from GitHub in a phone or computer
browser; keeping Codex or Claude open locally is unnecessary.

## One-time activation

1. Install `.github/workflows/dots-cloud.yml` and `tools/dots-cloud/` on the
   repository's **default branch**. GitHub requires this for manual dispatch.
2. Open [repository Actions secrets](https://github.com/surendertkd272/Stable_Management_system/settings/secrets/actions).
   Add `CLAUDE_CODE_OAUTH_TOKEN` for your Claude subscription. Alternatively,
   add `ANTHROPIC_API_KEY` if you choose API billing.
   The API key takes precedence if both Claude credentials exist.
   Never put these values in a task, issue, source file or chat.
3. For Claude subscription authentication, run `claude setup-token` locally and
   store its token in `CLAUDE_CODE_OAUTH_TOKEN` using the secrets page. Select the
   intended Claude account during authorization. Existing laptop logins do not
   automatically authenticate a GitHub runner. Do not copy a Keychain entry.
   For the secondary profile, run
   `CLAUDE_CONFIG_DIR="$HOME/.claude-dots-secondary" claude setup-token`.
   If `claude` is not on PATH, use `$HOME/.local/bin/claude`.
4. Open [Dots cloud task](https://github.com/surendertkd272/Stable_Management_system/actions/workflows/dots-cloud.yml),
   choose **Run workflow**, keep the workflow branch on the default branch,
   choose mode **check**, and select an existing target branch. A successful
   check verifies configuration and secret presence, not provider validity.
5. Keep **author = claude** to use your Claude subscription without an OpenAI API
   key. Plan limits still apply. Author and reviewer are separate Claude sessions.
   Optional **author = codex** requires an additional `OPENAI_API_KEY` and API
   billing; a local Codex login is not that credential. Codex can also coordinate
   interactively on your laptop without participating in the cloud job.

No GitHub App installation or personal access token is required. The runner uses
the short-lived `GITHUB_TOKEN`; only its publisher job receives contents-write
permission. It creates a branch and compare link, so permission to automatically
open pull requests is unnecessary.

## Give Dots a command

In **Run workflow**, select mode **task**, keep author **claude**, choose the pushed `target_branch`, and
enter a bounded outcome, for example:

```text
Fix owner access to reports: an owner must see only their assigned horses.
Trace UI → API → authorization → storage. Add regression tests for another
owner's horse and for admin access. Run tests, typecheck and build. Keep the
existing data model and public API. Report any incomplete acceptance criteria.
```

The default target is `feat/easier-calibration`, the development branch used
during setup. Select `main` only when that is the code you intend to change.
Only pushed commits are available: local edits, local credentials, camera data,
and the untracked `.codegraph/` index are not uploaded by this workflow.

From an authenticated terminal, the equivalent is:

```sh
gh workflow run dots-cloud.yml \
  --repo surendertkd272/Stable_Management_system \
  --ref main \
  -f mode=task \
  -f author=claude \
  -f target_branch=feat/easier-calibration \
  -f task='Fix owner report isolation and add regression tests.'
```

## Execution and results

```text
Manual task → configuration checks → immutable target commit
  → author (Claude by default): inspect instructions/architecture, plan, implement
  → fresh runner: typecheck + npm test + build + high-severity dependency audit
  → if checks fail: Claude repair once → fresh validation again
  → separate session: Claude reads the final diff and reviews correctness/security
  → publisher: recheck patch, save dots/task-<run>-<attempt>, show compare link
```

The author job has a 40-minute timeout. Claude authoring has at most 60 turns;
its optional repair job has 40 turns and 25 minutes. Claude authors can read and
edit source but cannot execute it. Test failures go to one repair session, and
the repaired candidate is validated again. Final validation and independent
review can run in parallel. Review has 30 turns and 20 minutes; each validation
has 25 minutes. Codex, when explicitly selected, can also test and try up to two
internal repair passes within its authoring job.

There is no automatic repair loop after independent review: findings stay visible
and the run fails. Submit a follow-up task against the saved task branch to repair
them. Concurrent tasks use independent snapshots and separate output branches.
Open the workflow run's summary for actual check outcomes and its compare link.
The `dots-candidate` artifact contains the patch and implementation report;
`dots-review` contains the independent review when available. A repaired candidate
is saved as `dots-repaired`. Validation log artifacts and a separate initial
implementation report aid diagnosis when a stage fails. Artifacts expire
after seven days. A failed validation or review still saves a structurally valid
patch as a branch, but leaves the run red. Invalid patches and unsuccessful
implementation jobs are not published. A timeout may leave only job logs.

Review the branch, then open/merge its pull request when appropriate. Dots does
not merge code, deploy the stable system, run a permanent background process,
or infer new tasks between commands. It is available on demand while your laptop
is off, subject to GitHub availability and provider limits. Checks and review
reduce mistakes; they cannot guarantee a bug-free or vulnerability-free result.

## Boundaries

- Dispatch is available to repository writers, not public issue commenters.
- Secrets are passed only to their individual agent action or presence check.
  Generated application code runs in disposable jobs with no production secrets.
  Codex uses its action's protected API proxy and workspace permission profile.
  Claude authors have source-scoped Edit/Write plus read/search tools; reviewers
  only have read/search tools. Claude cannot run generated code.
- The publisher executes the trusted controller from the workflow commit,
  never scripts supplied by the generated patch. Checkout credentials are not
  persisted by checkout. No shared dependency caches are used. Candidate hashes
  from the author job are checked before validation, review, repair and publication.
- Patches are limited to 1 MiB and 80 files. Hidden files, workflow/controller
  files, agent instructions, package manifests, dependency locks, runtime stores,
  symlinks, submodules, binary changes and mode changes are rejected. Common key
  patterns are checked; this is not a comprehensive secret scanner.
- Tasks that need protected paths require a separately reviewed maintainer change.
  Existing dependency vulnerabilities can block the audit even when unrelated to
  a task. Check logs and fix the dependency separately; do not weaken the gate.
- This repository is public. Task text, generated source and Actions logs can be
  visible to others. Use synthetic data, never private customer/horse records or
  device credentials. Production hardware and notification transports are not
  available for verification.
- CodeGraph is used only when an index exists on the runner; otherwise agents
  must report the gap and use normal source inspection.

Official setup references:
[Codex GitHub Action](https://learn.chatgpt.com/docs/github-action) and
[Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions).
