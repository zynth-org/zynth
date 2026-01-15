# @rune/splash-screen

Control the native launch screen.

This API allows you to keep the native splash screen visible while your application loads resources, fetches initial data, or hydrates its state. This prevents a "white flash" or empty screen during startup.

## Usage

### 1. Prevent Auto-Hide
Call this as early as possible (e.g., in your entry file) to stop the native system from removing the splash screen automatically.

```tsx
import { SplashScreen } from "@rune/splash-screen";

SplashScreen.preventAutoHideAsync();
```

### 2. Hide Manually
Once your app is ready (e.g., data loaded, first frame rendered), hide the splash screen.

```tsx
await fetchUserData();
SplashScreen.hideAsync();
```
