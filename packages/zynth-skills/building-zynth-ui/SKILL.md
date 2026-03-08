---
name: building-zynth-ui
description: Professional development guide for building high-performance, beautiful apps with the Zynth framework. Covers SolidJS reactivity, native styling, navigation, and animations.
version: 0.0.1
license: private
---

# Zynth UI Guidelines

## References

Consult these resources as needed for deep implementation details:

```
references/
  animations.md          ZynthAnimate: shared values, timing, spring, entry/exit, layout transitions
  controls.md            Native components: Button, Switch, Slider, DatePicker, TextField, Menu
  bottom-sheet.md        BottomSheet: snap points, controllers, and background interaction
  gradients.md           CSS-style linear-gradient backgrounds via 'background' prop
  icons.md               Zynth Icons (@zynth/icons) and native SF Symbols/Material Icons (SystemIcon)
  media.md               Camera, assets, and file system interactions
  navigation.md          Zynth Memory Router: Stack, Tabs, BottomSheet navigators, and hooks
  route-structure.md     FileSystemRouter: convention-based routing and manifest generation
  storage.md             AsyncStorage, SecureStore, and local database options
  styling.md             Zynth Styling: createStyle, mergeStyles, box-shadow, and layout props
  visual-effects.md      GlassView: tactile scale/tilt feedback and liquid glass effects
  skia.md                ZynthSkia: high-performance 2D graphics and shaders
```

## Development Workflow

**CRITICAL: Use the Zynth CLI for ephemeral native environment management.**

Zynth generates temporary `/ios` and `/android` directories. **NEVER** modify files inside these folders manually as they are overwritten.

1.  **Start Dev Server**: Use `yarn zynth dev ios` or `yarn zynth dev android`.
2.  **Use --prebuild**: When adding native modules or changing app configuration, always use the `--prebuild` flag to regenerate the native project.
3.  **Web Support**: Zynth supports web targets via `yarn zynth dev web`. It uses Vanilla CSS and optimized SolidJS rendering.

## Code Style

- **Fine-Grained Reactivity**: Use SolidJS signals (`createSignal`) and memos (`createMemo`). Avoid full component re-renders; Zynth updates only the specific native properties affected by signal changes.
- **Lists**: **NEVER** use `.map()` for dynamic lists. Use `<For>` for large arrays or `<Index>` for lists with stable positions (like navigation tabs) to minimize native recycling overhead.
- **File Naming**: Always use kebab-case for file names (e.g., `user-profile.tsx`).
- **Imports**: Prefer absolute path aliases (e.g., `@/components/Button`) over complex relative paths.

## Routes & Navigation

Zynth uses `@zynth/router` for application-level navigation.

- **Navigation Container**: Wrap your root component in `<NavigationContainer />`.
- **Navigators**: Use `createStackNavigator`, `createTabNavigator`, or `createBottomSheetNavigator`.
- **FileSystem Routing**: Zynth supports convention-based routing. Routes defined in the `app` or `src/screens` directory are automatically mapped via `createFileSystemRouter`.
- **Hooks**: Use `useNavigation()` to navigate and `useRoute()` to access params.
- **Native Transitions**: Zynth maps transitions directly to native engines (e.g., Apple's zoom transition, modal sheets).

## Library Preferences

- **Internal First**: Always prefer `@zynth/*` packages for core functionality (Animate, Icons, APIs, Screens).
- **Icons**: Use `@zynth/icons` for component-based icons or `<SystemIcon />` for platform-native symbols (SF Symbols on iOS).
- **Styling**: Use `createStyle` and `mergeStyles` from `@zynth/components` for reactive styling.
- **Reactivity**: `React.useContext` is **NOT** available; use `createContext` from `solid-js`.
- **Safe Areas**: Use `createSafeAreaInsets()` from `@zynth/apis` or `contentInsetAdjustmentBehavior="automatic"` on scrollable views.

## Responsiveness & Layout

- **Flexbox**: Use `gap`, `rowGap`, and `columnGap` for spacing. It is more predictable than margins for native layout.
- **Scrolling**: Always wrap long content in `<ScrollView />`. Apply `contentInsetAdjustmentBehavior="automatic"` to handle system bars automatically.
- **Screen Size**: Use `Dimensions.observe("window")` to react to orientation or size changes.
- **AspectRatio**: Use the `aspectRatio` style prop for consistent sizing of media or cards.

## Behavior & Feedback

- **Tactile Feedback**: Use `<Pressable enableGlassIOS />` for interactive surfaces; it provides automatic scale and tilt feedback.
- **Haptics**: Use `@zynth/haptics` to add subtle vibrations for important actions (success, warning, error).
- **Touch Targets**: Use `<Pressable />` for all interactive elements. It supports complex hit slops and state-based styling (pressed, hovered, focused).
- **Batched Updates**: Use `batch(() => { ... })` from `solid-js` when updating multiple signals to minimize bridge traffic.

## Styling

Zynth styles follow a hybrid approach props and CSS-like capabilities.

### General Rules

- **Shadows**: Prefer the CSS `boxShadow` prop (e.g., `boxShadow: "0 4px 12px rgba(0,0,0,0.1)"`). It supports multiple shadows via array syntax.
- **Gradients**: Use standard CSS `linear-gradient` strings in the `background` property.
- **Colors**: Hex, RGB, RGBA, and standard color names are supported.

### Text Styling

- **Tabular Numbers**: Use `{ fontVariant: ['tabular-nums'] }` for aligned counters or timers.
- **Selectable**: Add the `selectable` prop to `<Text />` for data that users might need to copy.
- **Nesting**: Icons from `@zynth/icons` can be nested directly inside `<Text />` elements and will inherit text styling.

## Navigation Patterns

### Stack Navigation

Define stacks with `Stack.Navigator` and `Stack.Screen`.

```tsx
<Stack.Screen
  name="Details"
  component={DetailsScreen}
  options={{
    title: "Detail View",
    headerBlurEffect: "systemThin",
    presentation: "zoom",
  }}
/>
```

### Context Menus

Use the `<Menu />` component for native-style context menus:

```tsx
<Menu>
  <Menu.Trigger>
    <Pressable>...</Pressable>
  </Menu.Trigger>
  <Menu.Item label="Share" icon={<FiShare />} onPress={handleShare} />
  <Menu.Item label="Delete" destructive onPress={handleDelete} />
</Menu>
```

### Bottom Sheets

Use `<BottomSheet />` for high-performance, native-backed modal sheets:

```tsx
<BottomSheet
  snapPoints={["25%", "50%", "90%"]}
  dismissOnOverlayPress
  overlayOpacity={0.5}
>
  <View>...</View>
</BottomSheet>
```

## Advanced UI

- **Shared Values**: Use `createSharedValue` and `createAnimatedStyle` for 60fps/120fps animations that run on the native UI thread.
- **Glass Effects**: Use `<GlassContainer />` to wrap content with dynamic blurring and transparency.
- **Skia**: For custom drawing or complex shaders, use `@zynth/skia`. It integrates seamlessly with Zynth signals for real-time performance.
