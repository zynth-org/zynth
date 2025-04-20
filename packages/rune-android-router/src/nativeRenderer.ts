/**
 * Native renderer bridge - allows native Fragments to render specific screens
 *
 * This installs a global function that native code can call to render a screen
 * into a specific rootId (Fragment's view).
 */

console.log("[nativeRenderer] 🔥 Installing __renderRouterScreen globally");

// Global function that native can call to render a screen into a specific rootId
if (typeof globalThis !== "undefined") {
  (globalThis as any).__renderRouterScreen = (
    rootId: number,
    screenName: string,
    params: any
  ) => {
    console.log(
      `[nativeRenderer] 🔥 __renderRouterScreen called: rootId=${rootId}, screenName=${screenName}, params=${JSON.stringify(
        params
      )}`
    );

    // For now, just log that we received the call
    // The actual rendering will be implemented in the next iteration
    console.log(
      `[nativeRenderer] ✅ Native Fragment ready to render ${screenName}`
    );
    console.log(
      `[nativeRenderer] 📝 TODO: Implement actual rendering into rootId=${rootId}`
    );
  };

  console.log(
    "[nativeRenderer] ✅ __renderRouterScreen installed successfully"
  );
}
