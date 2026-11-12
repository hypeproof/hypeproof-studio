#!/usr/bin/env node
// Runs one shard of the extension's `npm test` chain (#3417).
//
// `npm test` runs ~650 units one after another and took 65-77 min in CI. This
// script reads the same chain from package.json "test", so it can never drift
// from it, expands the `for f in test/*.smoke.mjs` loop into one unit per
// smoke file, and splits the units across N shards. CI runs the shards as a
// matrix; a local full run is still `npm test`.
//
//   node scripts/run-smoke-shard.mjs --shard 1/5   # run shard 1 of 5
//   node scripts/run-smoke-shard.mjs --shard 1/5 --list   # print its units only
//   node scripts/run-smoke-shard.mjs --plan 5      # print every shard's units and estimated time
//
// The split is deterministic: units are sorted by their measured duration
// (test/smoke-durations.json, longest first, ties by name) and each goes to the
// shard with the least estimated time so far (ties to the lowest shard). A unit
// with no measurement counts as DEFAULT_SECONDS. Inside a shard, units run in
// the same order as in `npm test`.
//
// Unlike `npm test`, a shard does not stop at the first failure: every unit in
// the shard runs, then the failures are listed and the exit code is 1.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SECONDS = 30;
const LOOP_RE = /^for f in test\/\*\.smoke\.mjs; do .*; done$/;

export function units(testScript, smokeFiles) {
  const segments = testScript.split(" && ").map((s) => s.trim());
  const out = [];
  let loops = 0;
  for (const seg of segments) {
    if (LOOP_RE.test(seg)) {
      loops += 1;
      for (const f of smokeFiles) {
        out.push({ id: f, argv: [process.execPath, "--experimental-strip-types", f] });
      }
    } else {
      out.push({ id: seg, shell: seg });
    }
  }
  if (loops !== 1) {
    throw new Error(`run-smoke-shard: expected exactly one "for f in test/*.smoke.mjs" loop in package.json "test", found ${loops}`);
  }
  return out;
}

export function plan(all, total, durations) {
  const cost = (u) => durations[u.id] ?? DEFAULT_SECONDS;
  const order = all
    .map((u, index) => ({ u, index }))
    .sort((a, b) => cost(b.u) - cost(a.u) || (a.u.id < b.u.id ? -1 : a.u.id > b.u.id ? 1 : 0));
  const shards = Array.from({ length: total }, () => ({ seconds: 0, items: [] }));
  for (const item of order) {
    let best = 0;
    for (let i = 1; i < total; i++) if (shards[i].seconds < shards[best].seconds) best = i;
    shards[best].seconds += cost(item.u);
    shards[best].items.push(item);
  }
  return shards.map((s) => ({
    seconds: s.seconds,
    units: s.items.sort((a, b) => a.index - b.index).map((x) => x.u),
  }));
}

function load() {
  const pkg = JSON.parse(fs.readFileSync(path.join(extRoot, "package.json"), "utf8"));
  // Same set the shell glob expands to; byte order, as in a C/POSIX locale.
  const smokeFiles = fs
    .readdirSync(path.join(extRoot, "test"))
    .filter((f) => f.endsWith(".smoke.mjs"))
    .sort()
    .map((f) => `test/${f}`);
  const durations = JSON.parse(fs.readFileSync(path.join(extRoot, "test", "smoke-durations.json"), "utf8"));
  return { all: units(pkg.scripts.test, smokeFiles), durations };
}

function parseShard(v) {
  const m = /^(\d+)\/(\d+)$/.exec(v ?? "");
  const index = m ? Number(m[1]) : NaN;
  const total = m ? Number(m[2]) : NaN;
  if (!m || total < 1 || index < 1 || index > total) {
    console.error(`run-smoke-shard: --shard wants <index>/<total>, like 1/5 (got ${v ?? "nothing"})`);
    process.exit(2);
  }
  return { index, total };
}

function fmt(seconds) {
  return `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, "0")}s`;
}

function main(argv) {
  const { all, durations } = load();
  const planAt = argv.indexOf("--plan");
  if (planAt !== -1) {
    const total = Number(argv[planAt + 1]);
    if (!Number.isInteger(total) || total < 1) {
      console.error("run-smoke-shard: --plan wants a shard count, like --plan 5");
      return 2;
    }
    plan(all, total, durations).forEach((s, i) => {
      console.log(`shard ${i + 1}/${total}: ${s.units.length} units, estimated ${fmt(s.seconds)}`);
    });
    return 0;
  }
  const shardAt = argv.indexOf("--shard");
  const { index, total } = parseShard(shardAt === -1 ? undefined : argv[shardAt + 1]);
  const shards = plan(all, total, durations);
  // Every unit lands in exactly one shard; a unit no shard runs would be a silent skip.
  const placed = shards.flatMap((s) => s.units);
  if (placed.length !== all.length || new Set(placed).size !== all.length || all.some((u) => !placed.includes(u))) {
    console.error(`run-smoke-shard: the ${total} shards do not cover the ${all.length} units exactly once`);
    return 1;
  }
  const mine = shards[index - 1];
  if (argv.includes("--list")) {
    for (const u of mine.units) console.log(u.id);
    return 0;
  }
  console.log(`run-smoke-shard: shard ${index}/${total}, ${mine.units.length} of ${all.length} units, estimated ${fmt(mine.seconds)}`);
  const failed = [];
  const timings = [];
  for (const u of mine.units) {
    console.log(`— ${u.id}`);
    const started = Date.now();
    const r = u.shell
      ? spawnSync(u.shell, { cwd: extRoot, stdio: "inherit", shell: "/bin/bash" })
      : spawnSync(u.argv[0], u.argv.slice(1), { cwd: extRoot, stdio: "inherit" });
    const seconds = (Date.now() - started) / 1000;
    timings.push([u.id, seconds]);
    if (r.status !== 0) {
      failed.push(u.id);
      const where = u.shell ? "" : ` file=extensions/hypeproof-chat/${u.id}`;
      console.log(`::error${where}::shard ${index}/${total}: ${u.id} failed (exit ${r.status ?? r.signal})`);
    }
  }
  timings.sort((a, b) => b[1] - a[1]);
  console.log(`run-smoke-shard: slowest units in shard ${index}/${total}:`);
  for (const [id, s] of timings.slice(0, 10)) console.log(`  ${fmt(s)}  ${id}`);
  if (failed.length) {
    console.error(`run-smoke-shard: shard ${index}/${total}: ${failed.length} failed:\n  ${failed.join("\n  ")}`);
    return 1;
  }
  console.log(`run-smoke-shard: shard ${index}/${total}: all ${mine.units.length} units passed`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
