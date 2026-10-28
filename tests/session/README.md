# Offline session regression

This fixture bundles the actual SessionProvider, JoinDialog and Lab with synthetic Clerk/Convex hooks. It never imports src/main.tsx, creates a Convex client, opens a service URL, or uses credentials. Browser contexts block all network requests and assert that none were attempted. Chrome uses a temporary profile. It does not use your signed-in browser profile.

Run from the repository root with the existing dependencies and an installed compatible Chrome:

```sh
CHROME_PATH='/path/to/chrome' node tests/session/run.mjs
```

If CHROME_PATH is omitted, the script uses Playwright's existing Chromium executable. It never installs browsers or packages. This is separate from npm test and from the prohibited live e2e/game.mjs suite.

For the identical tests against the provider before this fix, save `git show a6aa7ce:src/lib/session.tsx` to a temporary file outside the source tree, then set SESSION_SOURCE to that path. The Vite load override replaces only the provider's source while retaining its real import resolution. That baseline yields seven failures and eight passes; the fixed provider passes all fifteen cases.

Set SESSION_DIAGNOSTICS=1 to additionally print two observations: actual Lab draft retention across account switches and provider behavior with deliberately injected stale query data. These observations are not security guarantees or tests of the real SDK cache. The regression count remains fifteen; the runner also reports completion of the two diagnostic scenarios.

Real Clerk authentication, JWT validation, SDK query-cache transitions, session expiration, backend concurrency and production connectivity are not tested. React runs in StrictMode. The fixture's Fast Refresh lint exception applies only to this standalone test entry point.
