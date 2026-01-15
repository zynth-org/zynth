#!/usr/bin/env node
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

function run() {
  yargs(hideBin(process.argv))
    .commandDir("commands")
    .option("app", {
      alias: "a",
      type: "string",
      description: "Explicit app directory",
    })
    .demandCommand(1, "You need at least one command before moving on")
    .help()
    .strict().argv;
}

module.exports = { run };
