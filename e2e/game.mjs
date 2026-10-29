// End-to-end run of the whole game against a live stack (Convex, the GPU worker, Vite), in a real browser:
// play today's daily to a solve as a guest, sign up and keep that solve, predict and scan a neuron and catch it, replay
// yesterday's daily for practice, see the map, run a lab experiment, enter a bounty and get judged (and a second guest's
// guess scores while the judge holds the GPU). Also
// checks that future puzzles stay hidden and that a NaN bounty dose is refused, straight against the backend.
//
//   node e2e/game.mjs [--url http://127.0.0.1:5173]                                   # the local stack
//   node e2e/game.mjs --url https://neuronaut.ishaanko.com --deployment greedy-skunk-576   # a cloud deployment
//
// Signs in as a throwaway Clerk user (created through Clerk's backend API; it and its player are deleted at the end, so
// test runs don't show on the site), so it needs the dev
// instance's keys in .env.clerk.local (`clerk env pull --file .env.clerk.local`).
//
// Writes e2e/artifacts/<timestamp>/: a screenshot per step and report.json (each step, ok, details), and exits
// non-zero if a step fails. The daily's answer comes from `convex run admin:answer`, so the solve path is exercised.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { ConvexHttpClient } from "convex/browser";
import { chromium } from "playwright";

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const url = arg("--url") ?? "http://127.0.0.1:5173";
const deployment = arg("--deployment"); // unset: the local anonymous backend
const out = join("e2e", "artifacts", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(out, { recursive: true });
const report = { url, deployment: deployment ?? "local", steps: [] };
const handle = `e2e_${Math.random().toString(36).slice(2, 8)}`;
const guest = `${handle}_guest_token`; // the browser's guest token (src/players/guest.ts), named so cleanup can find it
const guest2 = `${handle}_guest2_token`; // a second guest who guesses while a bounty is judged

const keys = Object.fromEntries(
  readFileSync(".env.clerk.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => l.split(/=(.*)/s).slice(0, 2)),
);
process.env.CLERK_SECRET_KEY = keys.CLERK_SECRET_KEY;
process.env.CLERK_PUBLISHABLE_KEY = keys.VITE_CLERK_PUBLISHABLE_KEY;
async function clerkApi(method, path, body) {
  const r = await fetch(`https://api.clerk.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${keys.CLERK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Clerk ${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}
const email = `${handle.replace("_", "-")}+clerk_test@example.com`;
await clerkSetup();
const user = await clerkApi("POST", "/users", { email_address: [email], skip_password_requirement: true });

function convex(fn, args) {
  const env = deployment ? process.env : { ...process.env, CONVEX_AGENT_MODE: "anonymous", CONVEX_TMPDIR: join(process.cwd(), ".tmp") };
  const where = deployment ? ["--deployment", deployment] : [];
  const out = execFileSync("bunx", ["convex", "run", ...where, fn, JSON.stringify(args)], { env, encoding: "utf8" }).trim();
  return out ? JSON.parse(out) : null; // a null result prints nothing
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
await page.addInitScript((guest) => {
  localStorage.setItem("neuronaut:seen-howto", "1"); // the first-visit how-to card
  localStorage.setItem("neuronaut:guest", guest);
}, guest);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

async function step(name, fn) {
  const t0 = Date.now();
  let ok = true;
  let detail;
  try {
    detail = await fn();
  } catch (e) {
    ok = false;
    detail = String(e?.message ?? e).split("\n")[0];
  }
  await page.screenshot({ path: join(out, `${report.steps.length + 1}-${name}.png`), fullPage: true });
  report.steps.push({ name, ok, seconds: (Date.now() - t0) / 1000, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(detail)?.slice(0, 160)}`);
  if (!ok) throw new Error(name);
}

try {
  await step("guest: play the daily without an account", async () => {
    await page.goto(url + "/daily");
    await page.getByRole("button", { name: "Sign in" }).waitFor();
    await page.getByRole("heading", { name: /Daily #\d+/ }).waitFor({ timeout: 30000 });
    for (const [l, n] of [[5, 100], [17, 4242]]) {
      await page.getByLabel("layer", { exact: true }).fill(String(l));
      await page.getByLabel("neuron", { exact: true }).fill(String(n));
      await page.getByRole("button", { name: "Guess", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('input[aria-label="neuron"]')?.value);  // guess landed
    }
    await page.waitForFunction(() => document.querySelectorAll("[data-guess]").length >= 2 && !document.body.innerText.includes("measuring"), null, { timeout: 120000 });
    return { rows: (await page.locator("[data-guess]").allInnerTexts()).map((r) => r.replace(/\s+/g, " ")) };
  });

  await step("guest: solve, and the result asks for an account", async () => {
    const date = new Date().toISOString().slice(0, 10);
    const ans = convex("admin:answer", { date });
    await page.getByLabel("layer", { exact: true }).fill(String(ans.layer));
    await page.getByLabel("neuron", { exact: true }).fill(String(ans.n));
    await page.getByRole("button", { name: "Guess", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Today's result" }); // the result card opens by itself
    await dialog.waitFor({ timeout: 60000 });
    const card = await dialog.innerText();
    const time = card.match(/Solved in \d+ guess(?:es)?, (\d+:\d\d)/)?.[1];
    if (!time) throw new Error(`no solve time on the result card: ${card.replace(/\s+/g, " ").slice(0, 120)}`);
    await dialog.getByRole("button", { name: "Make an account" }).waitFor();
    await page.keyboard.press("Escape");
    return { answer: ans, time };
  });

  await step("sign up and keep the guest's solve", async () => {
    await clerk.signIn({ page, emailAddress: email });
    await page.getByPlaceholder("handle").fill(handle); // a new user is asked for a handle right away
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByRole("link", { name: handle }).waitFor();
    const solved = await page.getByText(/Solved in \d+/).first().textContent({ timeout: 30000 });
    const points = await page.getByTitle("Your points").innerText();
    if (/^0 pts/.test(points)) throw new Error(`the guest's solve paid nothing after sign-up: ${points}`);
    return { handle, solved, points };
  });

  await step("lens search", async () => {
    await page.goto(url + "/dex");
    await page.getByLabel("search lenses").fill("ocean");
    await page.getByRole("button", { name: "open" }).first().waitFor({ timeout: 15000 });
    return { results: await page.getByRole("button", { name: "open" }).count() };
  });

  let neuron;
  await step("predict and scan a random neuron", async () => {
    await page.getByRole("button", { name: "Random" }).click();
    await page.waitForURL(/\/n\/\d+\/\d+/);
    neuron = page.url().split("/n/")[1];
    await page.getByRole("button", { name: /Barely anything/ }).click(); // most neurons are quiet
    const effect = await page.getByText("What pushing it does").locator("..").innerText({ timeout: 30000 });
    const verdict = await page.getByText(/^You (called it|said)/).innerText();
    await page.getByText("Strength").waitFor({ timeout: 120000 });
    return { neuron, effect: effect.replace(/\s+/g, " "), verdict };
  });

  await step("catch it", async () => {
    await page.getByLabel("name", { exact: true }).fill("e2e catch");
    await page.getByRole("button", { name: "Catch" }).click();
    const msg = await page.getByText(/Caught\. \+\d+ pts/).textContent({ timeout: 30000 });
    await page.goto(url + "/dex");
    await page.getByText("e2e catch").first().waitFor();
    return { msg };
  });

  await step("practice: replay yesterday's puzzle for no points", async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const ans = convex("admin:answer", { date: yesterday });
    if (!ans) throw new Error(`no puzzle on ${yesterday}`);
    const before = await page.getByTitle("Your points").innerText();
    await page.goto(url + `/daily/${yesterday}`);
    await page.getByRole("heading", { name: /Practice #\d+/ }).waitFor({ timeout: 30000 });
    await page.getByLabel("layer", { exact: true }).fill(String(ans.layer));
    await page.getByLabel("neuron", { exact: true }).fill(String(ans.n));
    await page.getByRole("button", { name: "Guess", exact: true }).click();
    await page.getByRole("dialog", { name: "Today's result" }).waitFor({ timeout: 60000 });
    await page.keyboard.press("Escape");
    await page.getByText("Why each guess scored what it did").or(page.getByText(/Solved in 1/)).first().waitFor();
    const after = await page.getByTitle("Your points").innerText();
    if (before !== after) throw new Error(`practice paid points: ${before} -> ${after}`);
    return { yesterday, points: after };
  });

  await step("bounty: enter and get judged, and a guess scores meanwhile", async () => {
    await page.goto(url + "/bounties");
    await page.getByText("Lost at Sea").first().click();
    await page.getByRole("heading", { name: "Lost at Sea" }).waitFor();
    await page.getByLabel("layer", { exact: true }).fill("23");
    await page.getByLabel("neuron", { exact: true }).fill("8663");
    await page.getByLabel("dose").fill("0.6");
    await page.getByRole("button", { name: "Submit" }).click();
    // judging takes ~2 min on the GPU; a guess must not wait behind it: the worker answers guesses from the sweep's
    // store on a lane of its own. The guess is on a neuron Convex hasn't measured, so it needs the worker.
    const deadline = Date.now() + 30000;
    while (!convex("admin:running", {}).includes("judge"))
      if (Date.now() > deadline) throw new Error("the judge never started");
    let l, n;
    do [l, n] = [Math.floor(Math.random() * 32), Math.floor(Math.random() * 9216)];
    while (convex("admin:profiled", { layer: l, n }));
    const other = await browser.newPage();
    await other.addInitScript((g) => {
      localStorage.setItem("neuronaut:seen-howto", "1");
      localStorage.setItem("neuronaut:guest", g);
    }, guest2);
    await other.goto(url + "/daily");
    const t0 = Date.now();
    await other.getByLabel("layer", { exact: true }).fill(String(l));
    await other.getByLabel("neuron", { exact: true }).fill(String(n));
    await other.getByRole("button", { name: "Guess", exact: true }).click();
    await other.locator("[data-guess] .tabular-nums", { hasText: /^(\d+|hit)$/ }).waitFor({ timeout: 20000 }); // its heat
    const guessSeconds = (Date.now() - t0) / 1000;
    await other.close();
    if (!convex("admin:running", {}).includes("judge")) throw new Error("the judge finished before the guess scored");
    await page.getByText(/concept -?\d/).waitFor({ timeout: 180000 });
    const entry = await page.getByText(/concept -?\d/).locator("..").innerText();
    return { entry: entry.replace(/\s+/g, " "), guess: `${l}/${n}`, guessSeconds };
  });

  await step("map: visited neurons show up", async () => {
    await page.goto(url + "/map");
    const line = await page.getByText(/\d+ seen by you/).innerText({ timeout: 30000 });
    if (/ 0 seen by you/.test(line)) throw new Error(`nothing on the map after solving the daily: ${line}`);
    return { line };
  });

  await step("lab: two neurons pushed together", async () => {
    await page.goto(url + "/lab");
    const slots = [[25, 2719], [26, 8315]]; // two strong hydrogen neurons, so the result isn't "too faint to tell"
    for (const [i, [l, n]] of slots.entries()) {
      await page.getByLabel("layer", { exact: true }).nth(i).fill(String(l));
      await page.getByLabel("neuron", { exact: true }).nth(i).fill(String(n));
    }
    await page.getByRole("button", { name: "Run" }).click();
    const verdict = await page.getByText(/^(They add up|Mostly add up|They interfere|Too faint to tell)$/).first().innerText({ timeout: 180000 });
    const additivity = await page.getByText("Additivity").first().locator("..").innerText();
    return { verdict, additivity: additivity.replace(/\s+/g, " ") };
  });

  await step("future dailies stay hidden", async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const d = convex("daily:current", { date: tomorrow });
    if (d !== null) throw new Error(`daily for ${tomorrow} is readable`);
    return { tomorrow, current: d };
  });

  await step("NaN bounty dose is refused", async () => {
    // the browser client can send NaN (Convex float64 allows it), so call the backend the same way the app does
    const envUrl = deployment
      ? `https://${deployment}.convex.cloud`
      : readFileSync(".env.local", "utf8").match(/^VITE_CONVEX_URL=(.*)$/m)[1].trim();
    const jwt = await page.evaluate(() => window.Clerk.session.getToken({ template: "convex" }));
    const client = new ConvexHttpClient(envUrl);
    client.setAuth(jwt);
    try {
      await client.mutation("bounties:submit", { slug: "lost-at-sea", pushes: [{ layer: 23, n: 8663, dose: NaN }] });
    } catch (e) {
      if (/Doses are/.test(String(e?.data ?? e))) return "refused"; // production keeps the text only in ConvexError.data
      throw e;
    }
    throw new Error("NaN dose was accepted");
  });

  await step("trainer page", async () => {
    await page.goto(url + `/t/${handle}`);
    await page.getByText("Points").waitFor();
    const points = await page.getByText("Points").locator("..").innerText();
    return { points: points.replace(/\s+/g, " ") };
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
    return "none";
  });
} catch {
  // the failing step is already in the report
} finally {
  await browser.close();
  // leave nothing behind on the live site: the player and everything it did, then the Clerk user. A failed cleanup
  // fails the run, since its player would stay on the leaderboard. Each deletion runs even if the other fails.
  const cleanup = { name: "clean up the test player", ok: true, detail: "removed" };
  const errs = [];
  try {
    // the guest row became the player on sign-up; if the run stopped before that, remove the guest row instead
    const removed = convex("admin:removePlayer", { handle }) || convex("admin:removePlayer", { handle: `guest|${guest}` });
    if (!removed && report.steps[0]?.ok) throw new Error(`no player ${handle} or guest to remove`);
    convex("admin:removePlayer", { handle: `guest|${guest2}` }); // absent if the bounty step didn't get that far
  } catch (e) {
    errs.push(`player: ${String(e?.message ?? e).split("\n")[0]}`);
  }
  await clerkApi("DELETE", `/users/${user.id}`).catch((e) => errs.push(`clerk: ${String(e?.message ?? e).split("\n")[0]}`));
  if (errs.length) Object.assign(cleanup, { ok: false, detail: errs.join(" | ") });
  report.steps.push(cleanup);
  console.log(`${cleanup.ok ? "ok  " : "FAIL"} ${cleanup.name}: ${JSON.stringify(cleanup.detail)}`);
}

report.ok = report.steps.every((s) => s.ok) && report.steps.length === 15;
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
console.log(`${report.ok ? "PASS" : "FAIL"} -> ${out}`);
process.exit(report.ok ? 0 : 1);
