# Contributing

This repository is source-available, not open source: see [LICENSE](LICENSE). By opening a PR or issue you grant the
maintainer a license to use your contribution, as the LICENSE describes.

Setup is in [docs/running.md](docs/running.md). You can work on the client and backend without a GPU, but anything that
changes what the worker measures needs one to check.

## Before you start

- **Bugs** go in [issues](https://github.com/ishaanko/neuronaut/issues/new/choose). Small, obvious fixes can come
  straight as a PR.
- **Ideas** (new modes, rule changes, bounty ideas) start in
  [Ideas discussions](https://github.com/ishaanko/neuronaut/discussions/categories/ideas). Agree on the direction
  there before building it. A PR that changes how the game plays without that may be closed.
- **Interesting neurons** go in a neuron report. Good finds become bounties.
- **Security issues** go to a [private advisory](https://github.com/ishaanko/neuronaut/security/advisories/new). This
  includes anything that leaks a hidden answer.

## One problem per PR

Split independent fixes into separate PRs, even small ones. Include everything that one fix needs across `src/`,
`convex/` and `worker/`, and say why if it spans more than one.

## Show that it works

Say what you ran and what you saw. "Tests pass" on its own isn't enough.

- **Game behavior:** run `node e2e/game.mjs` against a local stack. If your change adds a behavior worth protecting,
  add a step to it.
- **Logic that's hard to see from the UI** (ranks, settlement, glitch detection): add a unit test that names the
  failure it catches. `bun run test` runs real Convex functions through `convex-test`, and `cd worker && uv run pytest`
  covers the worker. We don't take hand-rolled fakes of Convex: they skip the real validators and indexes, which is
  where the bugs have been.
- **UI:** add before/after screenshots to the PR. Don't commit them.
- **Worker:** say which GPU you ran it on, and include before/after numbers if it changes what gets measured or how
  fast.

CI typechecks, lints and builds every PR. It can't run the GPU.

## Style

- Commit titles and PR titles: `<type>(<scope>): <what changed>`, in plain words. For example
  `fix(daily): guesses no longer stall when a profile job fails`.
- Match the code around you. Game numbers live in `convex/rules.ts`, so change them there.
- UI: true black background, white text, dense and minimal. No decorative cards or pills, no em dashes in copy, and no
  animations that repaint continuously.
- If an agent did the work, end the PR description with the model and harness.

## Labels

PRs get a `size:*` label from their changed lines and a `vouch:*` label from [.github/VOUCHED.td](.github/VOUCHED.td).
Both are context for reviewers, not merge rules.
