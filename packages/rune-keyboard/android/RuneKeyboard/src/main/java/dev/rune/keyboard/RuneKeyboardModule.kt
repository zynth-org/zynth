package dev.rune.keyboard

import android.app.Activity
import android.content.Context
import android.graphics.Rect
import android.os.Build
import android.view.View
import android.view.inputmethod.InputMethodManager
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import com.rune.kit.runtime.RuneRuntime
import org.json.JSONObject

/**
 * Monitors keyboard visibility and exposes state to JavaScript.
 * 
 * Keyboard dismiss is handled via the RuneKeyboardBridge module which
 * exposes a "dismiss" method callable from JS via __modules.call().
 */
class RuneKeyboardModule(
    private val activity: Activity,
    private val runtime: RuneRuntime
) {
    private var lastState: KeyboardState? = null
    private var rootView: View? = null
    private var isKeyboardVisible = false
    private var keyboardHeight = 0f

    init {
        registerBridge()
        // installJSInterface is now called by the bridge's initialize() method
        // to ensure it runs on both initial load and runtime reloads.
        attachToRootView()
    }

    /**
     * Register the bridge module for JS→native communication
     */
    private fun registerBridge() {
        val bridge = RuneKeyboardBridge(this)
        runtime.installModules(listOf(bridge))
    }

    // MARK: - Lifecycle

    fun onDestroy() {
        rootView = null
    }

    // MARK: - JS Interface

    fun installJSInterface() {
        val code = """
            (function() {
              const listeners = [];
              let currentState = {
                isVisible: false,
                height: 0,
                screenY: 0,
                duration: 0,
                easing: 'keyboard',
                isAnimating: false
              };
              
              globalThis.__RUNE_KEYBOARD__ = {
                getState: function() {
                  return currentState;
                },
                isVisible: function() {
                  return currentState.isVisible;
                },
                getHeight: function() {
                  return currentState.height;
                },
                addChangeListener: function(listener) {
                  listeners.push(listener);
                  return function() {
                    const index = listeners.indexOf(listener);
                    if (index >= 0) {
                      listeners.splice(index, 1);
                    }
                  };
                },
                dismiss: function() {
                  // Use the __modules bridge to call native dismiss
                  if (globalThis.__modules && typeof globalThis.__modules.call === 'function') {
                    globalThis.__modules.call('RuneKeyboard', 'dismiss', {});
                  }
                },
                _updateState: function(state) {
                  currentState = state;
                  for (let i = 0; i < listeners.length; i++) {
                    try {
                      listeners[i](state);
                    } catch (error) {
                      console.error('[RuneKeyboard] Listener error:', error);
                    }
                  }
                }
              };
            })();
        """.trimIndent()

        evaluateJavaScript(code)
    }

    /**
     * Dismiss the keyboard programmatically
     */
    fun dismissKeyboard() {
        activity.runOnUiThread {
            val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager

            // Use the current focused view or fall back to the decor view for a valid window token
            val focused = activity.currentFocus
            val decor = activity.window?.decorView
            val token = focused?.windowToken ?: decor?.windowToken

            android.util.Log.d(
                "RuneKeyboard",
                "dismissKeyboard() called. focused=${focused != null} decorToken=${decor?.windowToken != null} token=${token != null}"
            )

            token?.let { imm.hideSoftInputFromWindow(it, 0) }

            // Clear focus to prevent immediate re-focus (mirrors RN behavior)
            focused?.clearFocus()
        }
    }

    // MARK: - Root View Attachment

    private fun attachToRootView() {
        // Attach to the content view instead of the decor view to avoid conflicting with 
        // other modules (like RuneSafeArea) that attach to the decor view root.
        // Insets are dispatched top-down, so we'll still receive them.
        rootView = activity.findViewById(android.R.id.content) ?: activity.window.decorView.rootView

        android.util.Log.d("RuneKeyboard", "Attached to root view: ${rootView?.javaClass?.simpleName} (id=${rootView?.id})")

        rootView?.let { view ->
            setupKeyboardListener(view)
        }
    }

    private fun setupKeyboardListener(view: View) {
        val density = view.resources.displayMetrics.density
        fun buildStateFromInsets(
            insets: WindowInsetsCompat,
            isAnimating: Boolean,
            duration: Float
        ): KeyboardState {
            val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
            val imeHeight = imeInsets.bottom / density
            val isVisible = imeHeight > 0
            val screenHeight = view.height / density
            val screenY = screenHeight - imeHeight
            return KeyboardState(
                isVisible = isVisible,
                height = imeHeight,
                screenY = screenY,
                duration = duration,
                easing = "keyboard",
                isAnimating = isAnimating
            )
        }

        // Use WindowInsetsAnimation for smooth keyboard tracking (API 30+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            ViewCompat.setWindowInsetsAnimationCallback(
                view,
                object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                    override fun onPrepare(animation: WindowInsetsAnimationCompat) {
                        super.onPrepare(animation)
                        // Animation is about to start
                    }

                    override fun onProgress(
                        insets: WindowInsetsCompat,
                        runningAnimations: MutableList<WindowInsetsAnimationCompat>
                    ): WindowInsetsCompat {
// Only process IME animations — return early if none present
                    if (runningAnimations.none { it.typeMask and WindowInsetsCompat.Type.ime() != 0 }) return insets

                        val state = buildStateFromInsets(insets, isAnimating = true, duration = 0.25f)

                        isKeyboardVisible = state.isVisible
                        keyboardHeight = state.height
                        publishStateToJS(state)
                        return insets
                    }

                    override fun onEnd(animation: WindowInsetsAnimationCompat) {
                        super.onEnd(animation)
                        
                        // Only process IME animations
                        if (animation.typeMask and WindowInsetsCompat.Type.ime() == 0) return
                        
                        // Get final state from the actual insets
                        val insets = ViewCompat.getRootWindowInsets(view) ?: return
                        val state = buildStateFromInsets(insets, isAnimating = false, duration = 0f)

                        isKeyboardVisible = state.isVisible
                        keyboardHeight = state.height
                        publishStateToJS(state)
                    }
                }
            )
            
            // Also listen for insets changes without animations (device/OEM differences).
            ViewCompat.setOnApplyWindowInsetsListener(view) { _, insets ->
                val state = buildStateFromInsets(insets, isAnimating = false, duration = 0f)

                if (state.isVisible != isKeyboardVisible || state.height != keyboardHeight) {
                    isKeyboardVisible = state.isVisible
                    keyboardHeight = state.height
                    publishStateToJS(state)
                }

                insets
            }

            ViewCompat.requestApplyInsets(view)
        } else {
            // Fallback for older APIs (< API 30) - use WindowInsets listener
            ViewCompat.setOnApplyWindowInsetsListener(view) { _, insets ->
                val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
                val imeHeight = imeInsets.bottom / density
                val isVisible = imeHeight > 0

                // Only update if state changed
                if (isVisible != isKeyboardVisible || imeHeight != keyboardHeight) {
                    val screenHeight = view.height / density
                    val screenY = screenHeight - imeHeight

                    val state = KeyboardState(
                        isVisible = isVisible,
                        height = imeHeight,
                        screenY = screenY,
                        duration = 0.25f,
                        easing = "keyboard",
                        isAnimating = false
                    )

                    isKeyboardVisible = isVisible
                    keyboardHeight = imeHeight
                    publishStateToJS(state)
                }

                insets
            }
            
            // Also use the global layout listener as fallback for edge cases on older APIs
            view.viewTreeObserver.addOnGlobalLayoutListener {
                val rect = Rect()
                view.getWindowVisibleDisplayFrame(rect)
                
                val screenHeight = view.rootView.height
                val keypadHeight = screenHeight - rect.bottom
                
                // Keyboard is visible if it takes up more than 15% of screen
                val isVisible = keypadHeight > screenHeight * 0.15
                val heightDp = keypadHeight / density

                if (isVisible != isKeyboardVisible) {
                    val screenHeightDp = screenHeight / density
                    val screenY = if (isVisible) screenHeightDp - heightDp else screenHeightDp

                    val state = KeyboardState(
                        isVisible = isVisible,
                        height = if (isVisible) heightDp else 0f,
                        screenY = screenY,
                        duration = 0.25f,
                        easing = "keyboard",
                        isAnimating = false
                    )

                    isKeyboardVisible = isVisible
                    keyboardHeight = if (isVisible) heightDp else 0f
                    publishStateToJS(state)
                }
            }
        }
    }

    // MARK: - Publish to JS

    private fun publishStateToJS(state: KeyboardState) {
        // Skip if unchanged
        if (lastState == state) {
            return
        }

        lastState = state

        val stateJSON = state.toJSON()
        android.util.Log.d("RuneKeyboard", "Publishing state to JS: $stateJSON")

        val code = """
            (function() {
              if (globalThis.__RUNE_KEYBOARD__) {
                globalThis.__RUNE_KEYBOARD__._updateState($stateJSON);
              }
            })();
        """.trimIndent()

        evaluateJavaScriptAsync(code)
    }

    private fun evaluateJavaScriptAsync(code: String) {
        try {
            android.util.Log.d("RuneKeyboard", "Evaluating JavaScript async (${code.length} chars)")
            // Use runtime.evaluateAsync which handles the adapter directly
            runtime.evaluateAsync(code)
        } catch (e: Exception) {
            android.util.Log.e("RuneKeyboard", "Failed to evaluate JavaScript async: ${e.message}", e)
        }
    }

    private fun evaluateJavaScript(code: String) {
        try {
            android.util.Log.d("RuneKeyboard", "Evaluating JavaScript (${code.length} chars)")
            // Use runtime.adapter.evaluate directly (synchronous)
            runtime.adapter.evaluate(code)
        } catch (e: Exception) {
            android.util.Log.e("RuneKeyboard", "Failed to evaluate JavaScript: ${e.message}", e)
        }
    }

    // MARK: - Data Models

    private data class KeyboardState(
        val isVisible: Boolean,
        val height: Float,
        val screenY: Float,
        val duration: Float,
        val easing: String,
        val isAnimating: Boolean
    ) {
        fun toJSON(): String {
            return JSONObject().apply {
                put("isVisible", isVisible)
                put("height", height.toDouble())
                put("screenY", screenY.toDouble())
                put("duration", duration.toDouble())
                put("easing", easing)
                put("isAnimating", isAnimating)
            }.toString()
        }
    }
}