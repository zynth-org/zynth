const newModuleCommand = require("./new-module");

module.exports = {
  command: "create <type> [name]",
  describe: "Create a Zynth resource",
  builder: (yargs) => {
    yargs
      .positional("type", {
        describe: "Resource type",
        choices: ["module"],
      })
      .positional("name", {
        describe: "Resource name (kebab-case)",
        type: "string",
      })
      .option("app", {
        alias: "a",
        type: "string",
        description: "Explicit app directory",
      })
      .option("description", {
        alias: "d",
        type: "string",
        description: "Module description",
      });
  },
  handler: (argv) => {
    if (argv.type === "module") {
      newModuleCommand.handler(argv);
      return;
    }
    // Should never happen because of choices, but keep for safety.
    console.error(`Unknown create type: ${argv.type}`);
    process.exit(1);
  },
};
