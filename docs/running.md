# Running Neuronaut

You need bun, uv and a CUDA GPU with 16 GB. I run it on a 4080 Super under WSL.

```sh
bun install
CONVEX_AGENT_MODE=anonymous bunx convex dev    # local backend on :3210
bunx convex env set WORKER_SECRET <secret>
bunx vite --port 5173 --host 127.0.0.1
```

Players sign in with [Clerk](https://clerk.com). Link a Clerk app (`clerk link`, then
`clerk env pull --file .env.clerk.local`), copy `VITE_CLERK_PUBLISHABLE_KEY` into `.env.local`, create a JWT template
named `convex` (Clerk's Convex preset), and set its issuer on the backend:
`bunx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev`.

The worker reads neuron-explorer's caches from `worker/cache/` (`lens_index.npz`, `steer_index.npz`, `vocab.json`,
symlinks are fine) and `CONVEX_URL` and `WORKER_SECRET` from `worker/.env.local`.

```sh
cd worker && uv sync
uv run python build_neurons.py > ../data/neurons.jsonl
bunx convex import --table neurons ../data/neurons.jsonl
set -a && . ./.env.local && set +a
uv run python main.py --sweep
```

`--sweep` measures every neuron whenever no player is waiting on the GPU. The first start also measures random-push
baselines for each layer and caches them. Hourly crons create dailies and bounties, and dailies need the worker up.

Once the sweep is done, lay out the map and load it:

```sh
uv run --group analysis python places.py     # writes ../data/places.jsonl and ../src/map/zones.json
bunx convex import --table places --replace ../data/places.jsonl
```

To leave it all running, use `./up.sh`. It starts Convex, Vite and the worker as systemd user
services that restart on a crash and log to `logs/`. `./up.sh stop` stops them. `nohup` and `setsid` stay in the
terminal's cgroup and die with it, so they don't work here.

Production: pushes to `main` deploy the site and the Convex backend together on Vercel (`vercel.json` runs
`convex deploy` with the prod deploy key). The GPU worker serves production as its own enabled unit, `./up.sh prod`,
which survives reboots and which the dev `./up.sh` never touches. `worker/.env.prod.local` holds the prod `CONVEX_URL`
and `WORKER_SECRET`. The E2E runs against it with
`node e2e/game.mjs --url https://neuronaut.ishaanko.com --deployment greedy-skunk-576`.

## Layout

| path | what |
| --- | --- |
| `src/` | React and Tailwind client, a folder per mode (`daily/`, `dex/`, `bounties/`, `lab/`, `map/`) plus `home/`, `learn/` and `players/`. Neuron widgets every mode uses live in `neuron/`, generic ones in `ui/` |
| `convex/` | players, scans, catches, dailies, bounties and the job queue. `rules.ts` holds the game numbers |
| `worker/` | pulls jobs from Convex, runs the model with HF transformers, writes results back. It needs no open port |
| `e2e/game.mjs` | plays every mode in a real browser |
| `e2e/session/` | offline browser checks for sign-in and account-switch races in `SessionProvider` |

## Testing

```sh
node e2e/game.mjs [--url http://127.0.0.1:5173]
```

Unit tests cover the logic that's hard to see from the UI: `bun run test` (backend, through `convex-test`) and
`cd worker && uv run pytest` (glitch detection, the sweep store). `node e2e/session/run.mjs` checks session races
(account switches, sign-out mid-join) against fake Clerk and Convex hooks, with no network.

The E2E joins, scans and catches a neuron, solves today's daily and enters a bounty. Screenshots and `report.json` land in
`e2e/artifacts/<timestamp>/`. On WSL without Chrome's system libraries, point `LD_LIBRARY_PATH` at a local copy.
