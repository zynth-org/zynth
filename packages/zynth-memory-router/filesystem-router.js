import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_SCREENS_DIR = "src/screens";
const DEFAULT_OUTPUT_PATH = ".zynth/router/screens.generated.ts";
const DEFAULT_MODULE_ID = "@zynth/memory-router/fs-routes";

const SUPPORTED_ROUTE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

export function resolveFileSystemRouterOptions(options = {}, appRoot) {
  if (!options.enable) {
    return null;
  }

  const screensDir = options.screensDir ?? DEFAULT_SCREENS_DIR;
  const outputPath = options.outputPath ?? DEFAULT_OUTPUT_PATH;
  return {
    screensDir: path.resolve(appRoot, screensDir),
    outputPath: outputPath,
    moduleId: options.moduleId ?? DEFAULT_MODULE_ID,
  };
}

export function memoryRouterFileSystemGeneratedModule(options = {}) {
  const normalized = {
    enable: options.enable ?? true,
    screensDir: options.screensDir,
    outputPath: options.outputPath,
    moduleId: options.moduleId,
  };

  return {
    kind: "generated-module",
    moduleId: normalized.moduleId ?? DEFAULT_MODULE_ID,
    outputPath: normalized.outputPath ?? DEFAULT_OUTPUT_PATH,
    async generate(context) {
      const resolved = resolveFileSystemRouterOptions(normalized, context.appRoot);
      if (!resolved) {
        return [
          "/* eslint-disable */",
          "// Filesystem router disabled.",
          "export const fileSystemRouterManifest = null;",
          "export default fileSystemRouterManifest;",
          "",
        ].join("\n");
      }

      const root = await scanRouteDirectory(resolved.screensDir, []);
      return buildRouteManifestModule(root, resolved.outputPath);
    },
  };
}

async function scanRouteDirectory(
  directoryPath,
  routeSegments,
  groupName = null,
) {
  const directory = {
    directoryPath,
    routeSegments,
    groupName,
    navigator: "stack",
    layoutFile: null,
    screenFiles: [],
    children: [],
  };

  let entries = [];
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return directory;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const absoluteEntryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const isGroup = isRouteGroupSegment(entry.name);
      const nextSegments = isGroup
        ? routeSegments
        : [...routeSegments, entry.name];
      const childGroupName = isGroup ? stripRouteGroup(entry.name) : null;
      const childDirectory = await scanRouteDirectory(
        absoluteEntryPath,
        nextSegments,
        childGroupName,
      );
      if (directoryContainsRoutes(childDirectory)) {
        directory.children.push(childDirectory);
      }
      continue;
    }

    if (!entry.isFile() || !isSupportedRouteFile(entry.name)) {
      continue;
    }

    const layoutType = getLayoutNavigatorType(entry.name);
    if (layoutType) {
      directory.navigator = layoutType;
      directory.layoutFile = absoluteEntryPath;
      continue;
    }

    if (entry.name.startsWith("_")) {
      continue;
    }

    directory.screenFiles.push({
      absolutePath: absoluteEntryPath,
      routeName: resolveScreenRouteName(routeSegments, entry.name),
    });
  }

  return directory;
}

function directoryContainsRoutes(directory) {
  return (
    directory.screenFiles.length > 0 ||
    directory.children.length > 0 ||
    directory.layoutFile !== null
  );
}

function isSupportedRouteFile(fileName) {
  return SUPPORTED_ROUTE_EXTENSIONS.some((extension) =>
    fileName.endsWith(extension),
  );
}

function getLayoutNavigatorType(fileName) {
  const normalized = fileName.toLowerCase();
  if (
    normalized.startsWith("_layout.tabs.") &&
    isSupportedRouteFile(normalized)
  ) {
    return "tabs";
  }
  if (
    normalized.startsWith("_layout.stack.") &&
    isSupportedRouteFile(normalized)
  ) {
    return "stack";
  }
  return null;
}

function resolveScreenRouteName(routeSegments, fileName) {
  const parsed = path.parse(fileName);
  if (parsed.name === "index") {
    return routeSegments.length > 0 ? routeSegments.join("/") : "index";
  }
  const fullSegments = [...routeSegments, parsed.name];
  return fullSegments.join("/");
}

function isRouteGroupSegment(segment) {
  return /^\(.+\)$/.test(segment);
}

function stripRouteGroup(segment) {
  return segment.slice(1, -1);
}

function buildRouteManifestModule(root, outputPath) {
  assertUniqueChildRouteNames(root);

  const imports = [];
  let importCounter = 0;

  const addImport = (absolutePath) => {
    const identifier = `module${importCounter++}`;
    const relativeImport = toImportPath(outputPath, absolutePath);
    imports.push(
      `import * as ${identifier} from ${JSON.stringify(relativeImport)};`,
    );
    return identifier;
  };

  const renderScreenNode = (screen) => {
    const moduleRef = addImport(screen.absolutePath);
    return [
      "{",
      '  kind: "screen",',
      `  name: ${JSON.stringify(screen.routeName)},`,
      `  component: (${moduleRef} as any).default,`,
      `  options: (${moduleRef} as any).options,`,
      `  initialParams: (${moduleRef} as any).initialParams,`,
      "}",
    ].join("\n");
  };

  const renderNavigatorNode = (directory) => {
    const layoutRef = directory.layoutFile
      ? addImport(directory.layoutFile)
      : null;
    const childNodes = [
      ...directory.screenFiles.map(renderScreenNode),
      ...directory.children.map(renderNavigatorNode),
    ];
    const navigatorName = resolveNavigatorRouteName(directory);
    const lines = [
      "{",
      '  kind: "navigator",',
      `  name: ${JSON.stringify(navigatorName)},`,
      `  navigator: ${JSON.stringify(directory.navigator)},`,
    ];
    if (layoutRef) {
      lines.push(`  options: (${layoutRef} as any).options,`);
      lines.push(`  initialRouteName: (${layoutRef} as any).initialRouteName,`);
      lines.push(`  tabBarOptions: (${layoutRef} as any).tabBarOptions,`);
    }
    lines.push("  children: [");
    if (childNodes.length > 0) {
      lines.push(indent(childNodes.join(",\n"), "    "));
    }
    lines.push("  ],");
    lines.push("}");
    return lines.join("\n");
  };

  const manifestLiteral = renderNavigatorNode(root);
  const header = [
    "/* eslint-disable */",
    "// Auto-generated by @zynth/memory-router. Do not edit manually.",
  ];

  return [
    ...header,
    ...imports,
    "",
    `export const fileSystemRouterManifest = ${manifestLiteral};`,
    "",
    "export default fileSystemRouterManifest;",
    "",
  ].join("\n");
}

function resolveNavigatorRouteName(directory) {
  const routePath = directory.routeSegments.join("/");
  if (routePath.length > 0) {
    return routePath;
  }
  return directory.groupName ?? "root";
}

function assertUniqueChildRouteNames(directory) {
  const seen = new Set();
  for (const screen of directory.screenFiles) {
    if (seen.has(screen.routeName)) {
      throw new Error(
        `[memory-router/fs] Duplicate route name '${screen.routeName}' in '${directory.directoryPath}'.`,
      );
    }
    seen.add(screen.routeName);
  }

  for (const child of directory.children) {
    const childName = resolveNavigatorRouteName(child);
    if (seen.has(childName)) {
      throw new Error(
        `[memory-router/fs] Duplicate route name '${childName}' in '${directory.directoryPath}'.`,
      );
    }
    seen.add(childName);
    assertUniqueChildRouteNames(child);
  }
}

function toImportPath(fromFile, toFile) {
  let relative = path
    .relative(path.dirname(fromFile), toFile)
    .split("\\")
    .join("/");
  if (!relative.startsWith(".")) {
    relative = `./${relative}`;
  }
  return relative;
}

function indent(value, prefix) {
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
