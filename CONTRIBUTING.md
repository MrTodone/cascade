# Contributing to Cascade

Thanks for wanting to help. This file is short on purpose — the quality bar is strict, but the process is boring.

## Ground rules

- **Offline by design.** The test suite must pass on one machine with no keys and no network. New dependencies are an uphill battle — prefer stdlib.
- **TypeScript, strict.** `@ts-expect-error` and `any` need a reason in the PR description.
- **No secrets in code, examples or tests.** Provider keys live only in `cascade-run/router/config.json` and `.env` (both gitignored). Examples use `YOUR_*_KEY` / `cascade-local` placeholders.

## Quality bar (all must pass before a PR is reviewable)

```sh
bun run lint                       # tsc --noEmit, clean
./scripts/cascade-router-test.sh   # offline mock suite: 113 PASS / 0 FAIL
bun cascade-router/tests/config.test.ts   # 15 PASS
bun cascade-router/tests/persist.test.ts  # 20 PASS
bun cascade-router/tests/heal.test.ts     # 19 PASS
```

If your change touches router behavior, also run the live regression against a running router:

```sh
bun scripts/regression.mjs   # 0 FAIL (external degradations may legitimately report WARN)
```

## Submitting

1. **Report a bug / propose a change** first (issue with a repro or a short idea). Large changes may be rejected by design — ask before building the whole thing.
2. Fork, branch (`fix/…`, `feat/…`), commit in small logical units.
3. PR against `main`, title = one sentence, description lists: what, why, how tested (the exact commands above), and any behavior change visible in the dashboard/API.
4. Reviewer passes the bar above and merges; you can expect feedback in days, not hours.

## What runs without secrets

- Mock suite, unit tests (`config` / `persist` / `heal`) and `bun run lint` — fully offline, no keys.
- `scripts/catalog-bootstrap.mjs` — needs a configured `cascade-run/router/config.json` (reads its `apiKeys`; providers without keys are skipped).
- `scripts/regression.mjs` — needs a running router and, for provider checks, live keys.

## First-time setup

```sh
git clone https://github.com/MrTodone/cascade
cd cascade
bun install
cp configs/router.config.example.json cascade-run/router/config.json
# fill YOUR_*_KEY values you want to test with
bun run dev
curl http://localhost:3000/v1/models
```