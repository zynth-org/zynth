#!/usr/bin/env node --experimental-strip-types

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: yarn generate icons --runtime");
  process.exit(1);
}

const [target, ...rest] = args;
if (target !== "icons") {
  console.error("Usage: yarn generate icons --runtime");
  process.exit(1);
}

const runtime = rest.includes("--runtime");
const cmdArgs = ["workspace", "@rune/icons", "generate"];
if (runtime) {
  cmdArgs.push("runtime");
}

const result = spawnSync("yarn", cmdArgs, { stdio: "inherit" });
process.exit(result.status ?? 1);
