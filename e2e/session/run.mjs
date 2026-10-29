// Offline rendered regression: real SessionProvider, JoinDialog and Lab; synthetic Clerk/Convex hooks.
// No app entry point, Convex client, credentials, services or inference are loaded.
import { build } from "vite";
import { chromium } from "playwright";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
const root = process.cwd();
const mock = resolve(root, "e2e/session/mocks.ts");
const source = resolve(root, "src/players/session.tsx");
const result = await build({
  configFile: false, root, logLevel: "error",
  plugins: process.env.SESSION_SOURCE ? [{ name: "original-session", enforce: "pre", load(id) {
    if (id === source) return readFileSync(process.env.SESSION_SOURCE, "utf8");
  } }] : [],
  resolve: { alias: [
    { find: "@clerk/react", replacement: mock },
    { find: "convex/react", replacement: mock },
  ] },
  build: { write: false, minify: false, lib: { entry: resolve(root, "e2e/session/fixture.tsx"), formats: ["iife"], name: "SessionTest" } },
  define: { "process.env.NODE_ENV": JSON.stringify("development") },
});
const bundle = (Array.isArray(result) ? result[0] : result).output.find((x) => x.type === "chunk").code;
const executablePath = process.env.CHROME_PATH || chromium.executablePath();
if (!existsSync(executablePath)) throw new Error("Set CHROME_PATH to an installed Chrome binary; this script never downloads a browser.");
const browser = await chromium.launch({ executablePath, headless: true, args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"] });
let failed = 0;
let passed = 0;
let blocked = 0;
const player = (handle) => ({ _id: handle, handle, points: 0, scansLeft: 12, catchesLeft: 3 });
async function test(name, run) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", (route) => { blocked++; return route.abort(); });
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => harness.render());
    await run(page);
    assert.deepEqual(errors, [], "Unexpected browser errors");
    console.log(`PASS ${name}`); passed++;
  } catch (error) { console.log(`FAIL ${name}: ${error.message}`); failed++; }
  finally { await context.close(); }
}
const outcomes = (p) => p.evaluate(() => ({ ...harness.outcomes }));
await test("simultaneous handle waiters settle once after another-tab player confirmation", async (p) => {
  await p.evaluate(async () => { await harness.request("a"); await harness.request("b"); });
  assert.deepEqual(await outcomes(p), {});
  await p.evaluate((me) => harness.render({ me }), player("Alice"));
  assert.deepEqual(await outcomes(p), { a: true, b: true });
});
await test("readiness waiter cannot resume as another account", async (p) => {
  await p.evaluate(async () => { await harness.render({ loading: true, me: undefined }); await harness.request("a"); });
  await p.evaluate((me) => harness.render({ sessionId: "bob", loading: false, me }), player("Bob"));
  assert.deepEqual(await outcomes(p), { a: false });
});
await test("handle waiter cancels on identity switch even when the new player is ready", async (p) => {
  await p.evaluate(() => harness.request("a"));
  await p.evaluate((me) => harness.render({ sessionId: "bob", me }), player("Bob"));
  assert.deepEqual(await outcomes(p), { a: false });
});
for (const loading of [false, true]) {
  await test(`unmount cancels ${loading ? "readiness" : "handle"} waiters`, async (p) => {
    await p.evaluate(async (loading) => { await harness.render({ loading, me: loading ? undefined : null }); await harness.request("a"); await harness.unmount(); }, loading);
    assert.deepEqual(await outcomes(p), { a: false });
  });
}
await test("join response does not resume actions before player query", async (p) => {
  await p.evaluate(async () => { harness.deferJoin(); await harness.request("a"); await harness.submit(); await harness.resolveJoin(); });
  assert.deepEqual(await outcomes(p), {});
  await p.evaluate((me) => harness.render({ me }), player("Alice"));
  assert.deepEqual(await outcomes(p), { a: true });
});
await test("join rejection cancels pending actions", async (p) => {
  await p.evaluate(async () => { harness.deferJoin(); await harness.request("a"); await harness.submit(); await harness.rejectJoin(); });
  assert.deepEqual(await outcomes(p), { a: false });
});
await test("old join success cannot release a new account's handle waiter", async (p) => {
  await p.evaluate(async () => { harness.deferJoin(); await harness.request("a"); await harness.submit(); await harness.render({ sessionId: "bob", me: null }); await harness.request("b"); await harness.resolveJoin(); });
  assert.deepEqual(await outcomes(p), { a: false });
});
await test("dialog cancellation settles all handle waiters", async (p) => {
  await p.evaluate(async () => { await harness.request("a"); await harness.request("b"); await harness.cancel(); });
  assert.deepEqual(await outcomes(p), { a: false, b: false });
});
await test("sign-out before handle selection cancels actions and invokes Clerk", async (p) => {
  await p.evaluate(async () => { await harness.request("a"); await harness.signOut(); });
  assert.deepEqual(await outcomes(p), { a: false });
  assert.equal((await p.evaluate(() => harness.clerkCalls())).signOuts, 1);
});
await test("a readiness wait can complete for the same account", async (p) => {
  await p.evaluate(async () => { await harness.render({ loading: true, me: undefined }); await harness.request("a"); });
  await p.evaluate((me) => harness.render({ loading: false, me }), player("Alice"));
  assert.deepEqual(await outcomes(p), { a: true });
});
await test("signed-out actions open Clerk without executing gameplay", async (p) => {
  await p.evaluate(async () => { await harness.render({ sessionId: null, authenticated: false, me: undefined }); await harness.request("a"); });
  assert.deepEqual(await outcomes(p), { a: false });
  assert.equal((await p.evaluate(() => harness.clerkCalls())).signIns, 1);
});
await test("explicit sign-out cancels readiness waiters before auth catches up", async (p) => {
  await p.evaluate(async () => { await harness.render({ loading: true, me: undefined }); await harness.request("a"); await harness.signOut(); });
  assert.deepEqual(await outcomes(p), { a: false });
  assert.equal((await p.evaluate(() => harness.clerkCalls())).signIns, 0);
});
await test("a click while auth loads opens Clerk once the visitor turns out to be signed out", async (p) => {
  await p.evaluate(async () => { await harness.render({ sessionId: undefined, loading: true, authenticated: false, me: undefined }); await harness.request("a"); });
  await p.evaluate(() => harness.render({ sessionId: null, loading: false }));
  assert.deepEqual(await outcomes(p), { a: false });
  assert.equal((await p.evaluate(() => harness.clerkCalls())).signIns, 1);
});
await test("a click before Clerk loads completes for the account that loads", async (p) => {
  await p.evaluate(async () => { await harness.render({ sessionId: undefined, loading: true, me: undefined }); await harness.request("a"); });
  await p.evaluate((me) => harness.render({ sessionId: "alice", loading: false, me }), player("Alice"));
  assert.deepEqual(await outcomes(p), { a: true });
});
if (process.env.SESSION_DIAGNOSTICS) {
  // Observations, not security pass assertions: these isolate local-state/cache-display limitations.
  await test("DIAGNOSTIC account switch with fresh query data retains the Lab draft", async (p) => {
    await p.evaluate((me) => harness.render({ me }), player("Alice"));
    const layer = p.getByRole("textbox", { name: "layer", exact: true }).first();
    await layer.fill("12");
    await p.evaluate((me) => harness.render({ sessionId: "bob", me }), player("Bob"));
    console.log("DIAGNOSTIC", JSON.stringify({ handle: await p.getByTestId("handle").textContent(), previousAccountDraftLayer: await layer.inputValue() }));
  });
  await test("DIAGNOSTIC injected stale player result is displayed during a session switch", async (p) => {
    await p.evaluate((me) => harness.render({ me }), player("Alice"));
    await p.evaluate(() => harness.render({ sessionId: "bob" }));
    console.log("DIAGNOSTIC", JSON.stringify({ clerkSession: "bob", displayedHandleWithStaleQuery: await p.getByTestId("handle").textContent() }));
  });
}
await browser.close();
assert.equal(blocked, 0, "The isolated fixture attempted a network request");
console.log(`${passed} passed; ${failed} failed; ${blocked} network requests`);
process.exitCode = failed ? 1 : 0;
