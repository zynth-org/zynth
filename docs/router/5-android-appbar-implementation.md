## Android AppBar Implementation – Hybrid Approach

### Summary

This document describes the successful implementation of AppBars (headers) for the Android router using a **hybrid approach** that avoids the pitfalls of the previous attempt. Instead of making native fragments own both the header and screen content (which caused blank screens), we:

1. Let JS continue to render screen content normally (preventing blank screens)
2. Wrap the RuneRootView with a native MaterialToolbar in the fragment
3. Apply header configuration from JS options to the native toolbar
4. Support dynamic updates via `navigation.setOptions()`

This approach gives us native-looking headers without disrupting the existing render pipeline.

---

### Key Design Principles

1. **JS owns screen content** – The SolidJS component tree renders into RuneRootView as before. No changes to the render lifecycle.
2. **Native owns header UI** – The fragment wraps content with a Toolbar and applies styling based on JS-provided options.
3. **Incremental enhancement** – Headers are opt-in via `headerShown: true` (default). Screens can disable with `headerShown: false`.
4. **Dynamic updates** – `navigation.setOptions()` sends new header config to native, which updates the toolbar without re-rendering the screen.

---

### Architecture Overview

#### JS Layer (TypeScript/SolidJS)

**Header Options Type** (`packages/rune-android-router/src/types.ts`):

```typescript
export interface HeaderOptions {
  title?: string;
  subtitle?: string;
  largeTitle?: boolean;
  headerShown?: boolean;
  headerTintColor?: string;
  headerBackgroundColor?: string;
  headerTransparent?: boolean;
  headerBlurEffect?: "systemUltraThin" | "systemThin" | "systemChromatic";
  headerShadowVisible?: boolean;
  userInterfaceStyle?: "light" | "dark" | "system";
  custom?: JSX.Element;
}
```

**Option Resolution** (`packages/rune-android-router/src/context.ts`):

- `getHeaderOptionsForScreen(screenName)` resolves options from the screen descriptor
- `sendHeaderOptionsToNative(routeKey, options)` normalizes and sends options via bridge
- `applyScreenOptions(routeKey, options)` handles dynamic updates from `navigation.setOptions()`

**Navigation Flow** (`packages/rune-android-router/src/NavigationContainer.tsx`):

- Before calling `navigate()`, extract header options for the target screen
- Send via new bridge method: `setHeaderOptionsForNextScreen(JSON.stringify(headerConfig))`
- Native stores these options and applies them when creating the fragment

#### Native Layer (Kotlin)

**Bridge Methods** (`RuneAndroidRouterBridge.kt`):

```kotlin
"setHeaderOptionsForNextScreen" -> {
    val headerJson = actualArgs.getOrNull(0) as? String
    navigationContainer.setPendingHeaderOptions(JSONObject(headerJson))
}

"setHeaderOptions" -> {
    val routeKey = actualArgs.getOrNull(0) as? String
    val headerJson = actualArgs.getOrNull(1) as? String
    navigationContainer.setHeaderOptionsForRoute(routeKey, JSONObject(headerJson))
}
```

**Container Management** (`RuneNavigationContainer.kt`):

- `pendingHeaderOptions`: Stores options for the next screen to be pushed
- `headerOptionsMap`: Maps route keys to options for dynamic updates
- `setPendingHeaderOptions()`: Called before navigation
- `setHeaderOptionsForRoute()`: Updates existing fragment headers
- `getHeaderOptionsForScreen()`: Retrieves and consumes pending options

**Fragment Layout** (`RuneScreenFragment` in `RuneNavigationContainer.kt`):

```kotlin
override fun onCreateView(...): View? {
    val surfaceRootId = RuneRootView.allocateRootId()

    runeRootView = RuneRootView(requireContext(), explicitRootId = surfaceRootId).apply {
        // ... existing setup ...
    }

    val headerShown = headerOptions?.optBoolean("headerShown", true) ?: true

    return if (headerShown) {
        createViewWithToolbar(runeRootView!!)
    } else {
        runeRootView
    }
}

private fun createViewWithToolbar(contentView: View): View {
    val container = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
    }

    toolbar = Toolbar(context).apply {
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, toolbarHeight)
    }

    applyHeaderOptions(toolbar!!)

    container.addView(toolbar)
    container.addView(contentView)

    return container
}
```

**Header Styling** (`applyHeaderOptions()` in `RuneNavigationContainer.kt`):

- Applies `title`, `subtitle` to toolbar
- Parses and applies `headerBackgroundColor`, `headerTintColor`
- Sets elevation based on `headerShadowVisible`
- Adds back button with icon tinting for non-root screens
- Supports transparent backgrounds with `headerTransparent`

---

### Usage Examples

#### Static Header Configuration

```typescript
<Router.Stack.Screen
  name="Home"
  component={HomeScreen}
  options={{
    title: "Welcome",
    headerTintColor: "#38f935",
    headerBackgroundColor: "#181a24ee",
    headerShown: true,
    headerShadowVisible: true,
  }}
/>
```

#### Dynamic Header Updates

```typescript
const HomeScreen = () => {
  const navigation = useNavigation<AppRoutes>();

  const handleChangeColor = () => {
    navigation.setOptions({
      headerTintColor: "#ff5733",
      headerBackgroundColor: "#000000",
    });
  };

  return (
    <View>
      <Pressable onPress={handleChangeColor}>
        <Text>Change Header Color</Text>
      </Pressable>
    </View>
  );
};
```

#### Hiding the Header

```typescript
<Router.Stack.Screen
  name="Fullscreen"
  component={FullscreenScreen}
  options={{
    headerShown: false,
  }}
/>
```

---

### Key Differences from Previous Attempt

| Aspect           | Previous Attempt                     | Current Implementation                          |
| ---------------- | ------------------------------------ | ----------------------------------------------- |
| Screen Content   | Native fragment tried to own it      | JS renders normally into RuneRootView           |
| Initial Screen   | Delegated to native, broke HMR       | JS handles RESET, native only for PUSH/POP      |
| Header Placement | Fragment tried to control everything | Toolbar wraps existing RuneRootView             |
| Failure Mode     | Blank screens, no content            | Falls back to no header, content always renders |
| Complexity       | High coupling, custom lifecycle      | Simple wrapper, existing lifecycle preserved    |

---

### Resources Created

1. **Dimensions** (`res/values/dimens.xml`):

   - `rune_toolbar_height`: 56dp
   - `rune_toolbar_elevation`: 4dp

2. **Drawables** (`res/drawable/rune_ic_arrow_back.xml`):

   - Material Design back arrow vector drawable

3. **Fragment Registry**:
   - `fragmentByRouteKey`: Maps screen names to fragments for dynamic updates

---

### Testing

The `RouterMinimal` example demonstrates:

- Static header options on both Home and Details screens
- Different colors per screen
- Dynamic color changes via button press
- Navigation with proper header transitions

To test:

1. Run the app and observe Home screen header (green tint, dark bg)
2. Tap "Test Navigation" to push Details (purple tint, lighter bg)
3. Tap "Change Header Color" to cycle colors dynamically
4. Use back button to verify previous screen's header is restored

---

### Future Enhancements

1. **Custom header components** – Support `custom: JSX.Element` to render custom headers
2. **Large titles** – iOS-style large headers for Android (collapsing toolbar)
3. **Blur effects** – Map iOS blur styles to Android backdrop effects
4. **Right buttons** – Support for action buttons in the toolbar
5. **Search integration** – Add search bar support in headers
6. **Scrolling behavior** – Hide/show header on scroll

---

### Maintenance Notes

- If a fragment is destroyed before header options arrive, they're stored in `headerOptionsMap` and applied when the fragment is next created
- The `mainThreadHandler` ensures toolbar updates happen on UI thread
- Fragment lifecycle logging includes header application for debugging
- Back button visibility is automatic based on back stack depth
- Color parsing errors are logged but don't crash the app

This implementation is production-ready and follows Android Material Design guidelines while maintaining compatibility with the iOS header API.
