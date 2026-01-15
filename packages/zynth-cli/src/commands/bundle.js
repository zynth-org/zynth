const { findWorkspaceRoot, bundle } = require("../utils");

module.exports = {
  command: "bundle <scope>",
  describe: "Bundle workspaces",
  builder: (yargs) => {
    yargs.positional("scope", {
      describe: "Scope to bundle",
      choices: ["apps", "packages", "all"],
      default: "all",
    });
  },
  handler: (argv) => {
    const root = findWorkspaceRoot(process.cwd());
    bundle(argv.scope, root);
  },
};
