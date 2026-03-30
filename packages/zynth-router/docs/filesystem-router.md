# Filesystem Router

The filesystem router generates a navigation manifest from a `src/screens` directory and lets the app render that manifest with `createFileSystemRouter()`. It is intended for applications that want navigation structure to follow the file tree while still using the same stack, tab, and screen APIs exposed by `@zynth/router`.

The generated manifest is enabled through Rsbuild and consumed from `@zynth/router/fs-routes`. The route tree is built from your screens directory, including nested layouts, route groups, and screen-level `options` and `initialParams` exports.

## Basic usage

### Enable the generated router module

Enable the feature in `rsbuild.config.ts`:

```ts
import { defineZynthConfig } from "@zynth/rsbuild-plugin";
import { routerFileSystem } from "@zynth/router/rsbuild";

export default defineZynthConfig(
  {},
  {
    plugin: {
      features: [routerFileSystem()],
    },
  },
);
```

With the default configuration:

- screens are read from `src/screens`
- the generated file is written to `.zynth/router/screens.generated.ts`
- the manifest is imported as `@zynth/router/fs-routes`

### Render the generated routes

```tsx
import { NavigationContainer, createFileSystemRouter } from "@zynth/router";
import fileSystemRouterManifest from "@zynth/router/fs-routes";

const AppScreens = createFileSystemRouter(fileSystemRouterManifest);

export function App() {
  return (
    <NavigationContainer>
      <AppScreens />
    </NavigationContainer>
  );
}
```

## Important and advanced examples

### Folder and file naming rules

A typical filesystem router tree might look like this:

```text
src/screens
├── _layout.stack.ts
├── index.tsx
├── about.tsx
├── virtual-list.tsx
└── (tabs)
    ├── _layout.tabs.ts
    ├── feed.tsx
    ├── settings.tsx
    └── profile
        ├── _layout.stack.tsx
        ├── index.tsx
        └── edit.tsx
```

The generator resolves routes from that tree with these rules:

- `index.tsx` maps to the current directory route.
- Any other file maps to its relative path, without the extension.
- `_layout.stack.ts`, `_layout.stack.tsx`, `_layout.tabs.ts`, and `_layout.tabs.tsx` define the navigator used for that directory.
- Files starting with `_` are ignored unless they are one of the supported layout files.
- A folder wrapped in parentheses, such as `(tabs)`, is a route group. It organizes files without adding a path segment to the final route names.

### How route names are resolved

For the example tree above, the route names are:

- `index`
- `about`
- `virtual-list`
- `tabs`
- `feed`
- `settings`
- `profile`
- `profile/edit`

The root directory uses `_layout.stack.ts`, so the app starts with a stack navigator. The `(tabs)` group uses `_layout.tabs.ts`, so its direct children are rendered as tabs. The `profile` directory then uses `_layout.stack.tsx`, so the `profile` tab renders its own nested stack.

### Directory-level layouts

A layout file controls the navigator for its directory and can export shared configuration:

```ts
import type { ScreenOptions } from "@zynth/router";

export const initialRouteName = "index";

export const options: ScreenOptions = {
  headerShown: true,
  headerBackgroundColor: "#121826",
  headerTintColor: "#f8fafc",
  contentBackgroundColor: "#0b1020",
};
```

For tab layouts, `tabBarOptions` can also be exported:

```ts
import type { ScreenOptions, TabBarOptions } from "@zynth/router";

export const initialRouteName = "settings";

export const options: ScreenOptions = {
  headerShown: false,
};

export const tabBarOptions: TabBarOptions = {
  tabBarBackgroundColor: "#111827",
  tabBarActiveTintColor: "#60a5fa",
  tabBarInactiveTintColor: "#64748b",
};
```

### Screen files

Each screen file should default-export the screen component. It can also export `options` and `initialParams`:

```tsx
import { Button, Text, View } from "@zynth/components";
import { useNavigation, type ScreenOptions } from "@zynth/router";

export const options: ScreenOptions = {
  title: "About",
};

export const initialParams = undefined;

export default function AboutScreen() {
  const navigation = useNavigation<Record<string, object | undefined>>();

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
      <Text>About</Text>
      <Button onPress={() => navigation.goBack()}>Go Back</Button>
    </View>
  );
}
```

### Route groups

The `(tabs)` folder in the example tree is a route group. It does not add `(tabs)` to route names. Instead:

- `(tabs)/feed.tsx` becomes `feed`
- `(tabs)/settings.tsx` becomes `settings`
- `(tabs)/profile/index.tsx` becomes `profile`

This is useful when a folder is only there to group a layout or separate features without affecting the public route names.

### Nested stacks inside tabs

The `profile` tab in the example tree demonstrates a nested stack:

- `src/screens/(tabs)/profile/_layout.stack.tsx` defines the navigator for the `profile` directory.
- `src/screens/(tabs)/profile/index.tsx` becomes the `profile` route.
- `src/screens/(tabs)/profile/edit.tsx` becomes the `profile/edit` route.

Because the `profile` directory is inside a tab layout, the `profile` route is still a tab entry, but that tab renders its own stack navigator internally.

### Customizing the generated module

`routerFileSystem()` accepts configuration when the defaults should change:

```ts
import { routerFileSystem } from "@zynth/router/rsbuild";

routerFileSystem({
  screensDir: "src/app-screens",
  outputPath: ".zynth/router/custom-routes.ts",
  moduleId: "@zynth/router/custom-routes",
});
```

These options change where screens are scanned from, where the generated file is written, and which module identifier is used when importing the manifest.

## Special cases and unusual features

- The root directory itself becomes a navigator node. If there are no route-group wrappers around the root, its generated navigator name is `root`.
- `index.*` resolves to the directory route name. At the root level, that route name is `index`.
- Duplicate child route names inside the same directory cause generation to fail.
- Layout files can export `options`, `initialRouteName`, and, for tab layouts, `tabBarOptions`.
- Screen files can export `options` and `initialParams` in addition to their default component.
- Route groups affect organization only. They do not appear in the final route path.
- The generated manifest is static. Runtime route discovery is not part of this feature.

## API Reference

### Build-time API

#### `routerFileSystem(options?)`

Enables filesystem route generation through the Rsbuild plugin feature system.

Options:

- `enable?: boolean`
- `screensDir?: string`
- `outputPath?: string`
- `moduleId?: string`

#### `routerFileSystemGeneratedModule(options?)`

Returns the generated-module feature consumed by the build pipeline.

### Runtime API

#### `createFileSystemRouter(manifest)`

Accepts a `FileSystemRouterManifest` and returns a component that renders the generated navigator tree.

### Filesystem exports recognized by the generator

#### Layout files

- `_layout.stack.ts`
- `_layout.stack.tsx`
- `_layout.tabs.ts`
- `_layout.tabs.tsx`

Exports read from layout files:

- `options`
- `initialRouteName`
- `tabBarOptions`

#### Screen files

Any `.ts`, `.tsx`, `.js`, or `.jsx` file in the screens tree that is not a layout file and does not start with `_`.

Exports read from screen files:

- `default`
- `options`
- `initialParams`
