// End-to-end run of the whole game against a live stack (Convex, the GPU worker, Vite), in a real browser:
// sign in, pick a handle, predict and scan a neuron and catch it, play today's daily to a solve, replay yesterday's for
// practice, see the map, run a lab experiment, enter a bounty and get judged. Also
// checks that future puzzles stay hidden and that a NaN bounty dose is refused, straight against the backend.
//
//   node e2e/game.mjs [--url http://127.0.0.1:5173]                                   # the local stack
//   node e2e/game.mjs --url https://neuronaut.ishaanko.com --deployment greedy-skunk-576   # a cloud deployment
//
// Signs in as a throwaway Clerk user (created through Clerk's backend API, deleted at the end), so it needs the dev
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
await page.addInitScript(() => localStorage.setItem("neuronaut:seen-howto", "1")); // the first-visit how-to card
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
  await step("sign in and pick a handle", async () => {
    await page.goto(url + "/");
    await page.getByRole("button", { name: "Sign in" }).waitFor();
    await clerk.signIn({ page, emailAddress: email });
    await page.getByPlaceholder("handle").fill(handle); // a new user is asked for a handle right away
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByRole("link", { name: handle }).waitFor();
    return { handle };
  });

  await step("lens search", async () => {
    await page.goto(url + "/dex");
    await page.getByPlaceholder(/search lenses/).fill("ocean");
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

  await step("daily: wrong guesses get heat", async () => {
    await page.goto(url + "/daily");
    await page.getByRole("heading", { name: /DAILY #\d+/ }).waitFor({ timeout: 30000 });
    for (const [l, n] of [[5, 100], [17, 4242]]) {
      await page.getByLabel("layer", { exact: true }).fill(String(l));
      await page.getByLabel("neuron", { exact: true }).fill(String(n));
      await page.getByRole("button", { name: "Guess", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('input[aria-label="neuron"]')?.value);  // guess landed
    }
    await page.waitForFunction(() => document.querySelectorAll("[data-guess]").length >= 2 && !document.body.innerText.includes("measuring"), null, { timeout: 120000 });
    return { rows: (await page.locator("[data-guess]").allInnerTexts()).map((r) => r.replace(/\s+/g, " ")) };
  });

  await step("daily: solve", async () => {
    const date = new Date().toISOString().slice(0, 10);
    const ans = convex("admin:answer", { date });
    await page.getByLabel("layer", { exact: true }).fill(String(ans.layer));
    await page.getByLabel("neuron", { exact: true }).fill(String(ans.n));
    await page.getByRole("button", { name: "Guess", exact: true }).click();
    const solved = await page.getByText(/Solved in \d+/).first().textContent({ timeout: 60000 });
    await page.getByRole("dialog", { name: "Today's result" }).waitFor(); // the result card opens by itself
    await page.keyboard.press("Escape");
    return { answer: ans, solved };
  });

  await step("practice: replay yesterday's puzzle for no points", async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const ans = convex("admin:answer", { date: yesterday });
    if (!ans) throw new Error(`no puzzle on ${yesterday}`);
    const before = await page.getByTitle("Your points").innerText();
    await page.goto(url + `/daily/${yesterday}`);
    await page.getByRole("heading", { name: /PRACTICE #\d+/ }).waitFor({ timeout: 30000 });
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

  await step("bounty: enter and get judged", async () => {
    await page.goto(url + "/bounties");
    await page.getByText("Lost at Sea").first().click();
    await page.getByRole("heading", { name: "Lost at Sea" }).waitFor();
    await page.getByLabel("layer", { exact: true }).fill("23");
    await page.getByLabel("neuron", { exact: true }).fill("8663");
    await page.getByLabel("dose").fill("0.6");
    await page.getByRole("button", { name: "Submit" }).click();
    await page.getByText(/concept -?\d/).waitFor({ timeout: 120000 });
    const entry = await page.getByText(/concept -?\d/).locator("..").innerText();
    return { entry: entry.replace(/\s+/g, " ") };
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
  await clerkApi("DELETE", `/users/${user.id}`).catch((e) => console.log("cleanup:", e.message));
}

report.ok = report.steps.every((s) => s.ok) && report.steps.length === 14;
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
console.log(`${report.ok ? "PASS" : "FAIL"} -> ${out}`);
process.exit(report.ok ? 0 : 1);
