const fs = require("fs");
const path = require("path");
const prompts = require("prompts");
const chalk = require("chalk");
const { findWorkspaceRoot, readJSON } = require("../utils");

async function createNewApp(argv) {
  const root = findWorkspaceRoot(process.cwd());
  const { directory, path: customPath } = argv;

  const baseDir = customPath ? path.resolve(customPath) : process.cwd();

  if (directory && fs.existsSync(path.join(baseDir, directory))) {
    console.error(
      chalk.red(`Directory '${directory}' already exists in '${baseDir}'.`)
    );
    process.exit(1);
  }

  let appDirectory = directory;
  if (!appDirectory) {
    const response = await prompts({
      type: "text",
      name: "directory",
      message: "Enter the directory name for your new app:",
      validate: (value) =>
        fs.existsSync(path.join(baseDir, value))
          ? "Directory already exists"
          : true,
    });
    appDirectory = response.directory;
  }

  if (!appDirectory) {
    console.error(chalk.red("App directory is required."));
    process.exit(1);
  }

  const appPath = path.join(baseDir, appDirectory);
  const appName = path.basename(appPath);
  const templatesDir = path.join(root, "packages", "zynth-templates");
  const appTemplateDir = path.join(templatesDir, "app");

  const questions = [
    {
      type: "text",
      name: "displayName",
      message: "Enter the display name for your app:",
      initial: appName,
    },
    {
      type: "text",
      name: "slug",
      message: "Enter the slug for your app:",
      initial: appName.toLowerCase().replace(/\s+/g, "-"),
    },
  ];

  const { displayName, slug } = await prompts(questions);

  if (!displayName || !slug) {
    console.error(chalk.red("App name and slug are required."));
    process.exit(1);
  }

  console.log(chalk.cyan(`Creating a new Zynth app in ${appPath}`));

  fs.mkdirSync(appPath, { recursive: true });

  // Copy app templates
  fs.cpSync(appTemplateDir, appPath, { recursive: true });

  // Create src folder and files
  const srcDir = path.join(appPath, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(
    path.join(srcDir, "index.tsx"),
    `import { start } from "@zynth/core";
import App from "./App";

start(App);`
  );
  fs.writeFileSync(
    path.join(srcDir, "App.tsx"),
    `import { View, Text } from "@zynth/components";

export default function App() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text>Welcome to Zynth</Text>
    </View>
  );
}`
  );

  // Update app.json
  const appJsonPath = path.join(appPath, "app.json");
  const appJson = readJSON(appJsonPath);
  appJson.name = displayName;
  appJson.slug = slug;
  if (!appJson.zynth || typeof appJson.zynth !== "object") {
    appJson.zynth = {};
  }
  appJson.zynth.name = displayName;
  appJson.zynth.slug = slug;
  fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2));

  // Update package.json
  const packageJsonPath = path.join(appPath, "package.json");
  const packageJson = readJSON(packageJsonPath);
  packageJson.name = slug;
  const localZynthResolutions = {};
  const resolvedZynthPackages = new Set();
  const resolutionQueue = [];
  function addLocalResolution(depName) {
    if (!depName.startsWith("@zynth/")) {
      return;
    }
    const folderName = depName.replace("@zynth/", "zynth-");
    const localPkgPath = path.join(root, "packages", folderName);
    if (!fs.existsSync(localPkgPath)) {
      return;
    }
    const relativePath = path.relative(appPath, localPkgPath) || ".";
    const fileRef = `file:${relativePath}`;
    localZynthResolutions[depName] = fileRef;
    if (!resolvedZynthPackages.has(depName)) {
      resolvedZynthPackages.add(depName);
      resolutionQueue.push({ depName, localPkgPath });
    }
  }
  const dependencySections = ["dependencies", "devDependencies"];
  for (const section of dependencySections) {
    if (!packageJson[section] || typeof packageJson[section] !== "object") {
      continue;
    }
    for (const depName of Object.keys(packageJson[section])) {
      if (!depName.startsWith("@zynth/")) {
        continue;
      }
      addLocalResolution(depName);
      if (!localZynthResolutions[depName]) {
        delete packageJson[section][depName];
        continue;
      }
      packageJson[section][depName] = localZynthResolutions[depName];
    }
  }
  while (resolutionQueue.length > 0) {
    const next = resolutionQueue.shift();
    if (!next) {
      continue;
    }
    const depPackage = readJSON(path.join(next.localPkgPath, "package.json"));
    if (!depPackage) {
      continue;
    }
    const sources = [
      depPackage.dependencies || {},
      depPackage.peerDependencies || {},
      depPackage.devDependencies || {},
    ];
    for (const source of sources) {
      for (const depName of Object.keys(source)) {
        if (depName.startsWith("@zynth/")) {
          addLocalResolution(depName);
        }
      }
    }
  }
  if (Object.keys(localZynthResolutions).length > 0) {
    packageJson.resolutions = {
      ...(packageJson.resolutions || {}),
      ...localZynthResolutions,
    };
  }
  if (!packageJson.zynth || typeof packageJson.zynth !== "object") {
    packageJson.zynth = {};
  }
  packageJson.zynth.frameworkRoot = path.relative(appPath, root) || ".";
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

      console.log(`\n\x1b[32m✔\x1b[0m App created successfully!`);

  
  console.log(
    chalk.cyan(`To get started, run:

  cd ${directory}
  yarn zynth dev ios`)
  );
}

module.exports = {
  command: "new [directory]",
  describe: "Create a new Zynth app",
  builder: (yargs) => {
    yargs
      .positional("directory", {
        describe: "The directory to create the app in",
        type: "string",
      })
      .option("path", {
        alias: "p",
        type: "string",
        description: "The path to create the app in",
      });
  },
  handler: (argv) => {
    createNewApp(argv).catch((err) => {
      console.error(chalk.red(err.stack));
      process.exit(1);
    });
  },
};
