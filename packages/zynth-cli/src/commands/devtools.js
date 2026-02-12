const { createDevtoolsHub } = require("../devtools/hub");

module.exports = {
  command: "devtools",
  describe: "Start the Zynth devtools pub/sub hub",
  builder: (yargs) => {
    yargs.option("port", {
      type: "number",
      default: 8091,
      describe: "Port for the devtools WebSocket server",
    });
    yargs.option("host", {
      type: "string",
      default: "0.0.0.0",
      describe: "Host for the devtools WebSocket server",
    });
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "Print events as JSON lines",
    });
    yargs.option("silent", {
      type: "boolean",
      default: false,
      describe: "Disable console printing of incoming events",
    });
    yargs.option("topic", {
      type: "array",
      describe: "Only print events matching these topics (supports *)",
    });
    yargs.option("level", {
      type: "array",
      describe: "Only print events matching these levels",
    });
    yargs.option("tag", {
      type: "array",
      describe: "Only print events matching these tags",
    });
    yargs.option("show-automation", {
      type: "boolean",
      default: false,
      describe: "Print automation transport events (automation/* topics)",
    });
    yargs.option("replay-limit", {
      type: "number",
      default: 200,
      describe: "Number of recent events kept for replay",
    });
  },
  handler: async (argv) => {
    const hub = createDevtoolsHub({
      host: argv.host,
      port: argv.port,
      print: !argv.silent,
      json: argv.json,
      replayLimit: argv.replayLimit,
      filters: {
        topics: (argv.topic || []).map(String),
        levels: (argv.level || []).map((value) => String(value).toLowerCase()),
        tags: (argv.tag || []).map(String),
        hideAutomation: !argv.showAutomation,
      },
    });
    const server = await hub.start();
    console.log(
      `◆ Zynth devtools hub listening at ws://${server.host}:${server.port}`
    );
    await new Promise(() => {});
  },
};
