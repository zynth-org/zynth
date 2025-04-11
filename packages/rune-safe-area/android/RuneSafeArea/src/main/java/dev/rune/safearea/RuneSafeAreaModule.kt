package dev.rune.safearea

import android.app.Activity
import android.content.res.Configuration
import android.view.View
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.rune.kit.runtime.RuneRuntime
import org.json.JSONObject

/**
 * Monitors WindowInsets and exposes safe area metrics to JavaScript
 */
class RuneSafeAreaModule(
    private val activity: Activity,
    private val runtime: RuneRuntime
) {
    private var lastMetrics: WindowMetrics? = null
    private var pendingUpdate = false
    private var rootView: View? = null

    init {
        android.util.Log.d("RuneSafeArea", "Module instance created")
        attachToRootView()
        installJSInterface()
    }

    // MARK: - Lifecycle

    fun onDestroy() {
        rootView = null
    }

    // MARK: - JS Interface

    private fun installJSInterface() {
        // Get initial metrics synchronously
        val initialMetrics = getCurrentMetrics()
        val initialMetricsJSON = initialMetrics?.toJSON() ?: "null"
        
        android.util.Log.d("RuneSafeArea", "Initial metrics: $initialMetricsJSON")
        
        val code = """
            (function() {
              const listeners = [];
              let currentMetrics = $initialMetricsJSON;
              
              globalThis.__RUNE_SAFE_AREA__ = {
                getInitialMetrics: function() {
                  return currentMetrics;
                },
                addMetricsChangeListener: function(listener) {
                  listeners.push(listener);
                  return function() {
                    const index = listeners.indexOf(listener);
                    if (index >= 0) {
                      listeners.splice(index, 1);
                    }
                  };
                },
                _updateMetrics: function(metrics) {
                  currentMetrics = metrics;
                  for (let i = 0; i < listeners.length; i++) {
                    try {
                      listeners[i](metrics);
                    } catch (error) {
                      console.error('[RuneSafeArea] Listener error:', error);
                    }
                  }
                }
              };
              
              console.log('[RuneSafeArea] Module installed with initial metrics:', currentMetrics);
            })();
        """.trimIndent()

        evaluateJavaScript(code)
    }

    // MARK: - Root View Attachment

    private fun attachToRootView() {
        rootView = activity.window.decorView.rootView

        rootView?.let { view ->
            // Set up WindowInsets listener
            ViewCompat.setOnApplyWindowInsetsListener(view) { _, insets ->
                scheduleMetricsUpdate()
                insets
            }

            // Listen for configuration changes (orientation, etc.)
            view.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
                override fun onViewAttachedToWindow(v: View) {
                    scheduleMetricsUpdate()
                }

                override fun onViewDetachedFromWindow(v: View) {
                    // No-op
                }
            })

            // Trigger initial update
            scheduleMetricsUpdate()
        }
    }

    // MARK: - Metrics Calculation

    private fun getCurrentMetrics(): WindowMetrics? {
        val view = rootView ?: activity.window.decorView.rootView
        
        val windowInsets = ViewCompat.getRootWindowInsets(view) ?: run {
            android.util.Log.w("RuneSafeArea", "No window insets available, trying to get from last applied")
            // Try to get the last window insets that were applied
            view.rootWindowInsets?.let { insets ->
                return convertInsetsToMetrics(insets, view)
            }
            android.util.Log.w("RuneSafeArea", "No insets available at all")
            return null
        }

        // Get system bar insets
        val systemBarsInsets = windowInsets.getInsets(
            WindowInsetsCompat.Type.systemBars()
        )

        // Get display cutout insets
        val displayCutoutInsets = windowInsets.getInsets(
            WindowInsetsCompat.Type.displayCutout()
        )

        // Combine system bars and display cutout
        val combinedInsets = Insets.max(systemBarsInsets, displayCutoutInsets)

        // Get view bounds and density
        val width = view.width
        val height = view.height
        val density = view.resources.displayMetrics.density

        // Convert physical pixels to dp
        val topDp = combinedInsets.top / density
        val rightDp = combinedInsets.right / density
        val bottomDp = combinedInsets.bottom / density
        val leftDp = combinedInsets.left / density
        
        val widthDp = width / density
        val heightDp = height / density

        // Calculate safe frame in dp
        val safeFrame = SafeAreaFrame(
            x = leftDp,
            y = topDp,
            width = widthDp - leftDp - rightDp,
            height = heightDp - topDp - bottomDp
        )

        return WindowMetrics(
            insets = SafeAreaInsets(
                top = topDp,
                right = rightDp,
                bottom = bottomDp,
                left = leftDp
            ),
            frame = safeFrame
        )
    }

    // MARK: - Update Pipeline (Coalesced)

    private fun scheduleMetricsUpdate() {
        if (pendingUpdate) return
        pendingUpdate = true

        // Coalesce updates to next frame
        rootView?.post {
            pendingUpdate = false
            updateMetrics(force = false)
        }
    }

    private fun updateMetrics(force: Boolean) {
        val newMetrics = getCurrentMetrics() ?: run {
            android.util.Log.w("RuneSafeArea", "Failed to get current metrics")
            return
        }

        // Skip if unchanged (unless forced)
        if (!force && lastMetrics == newMetrics) {
            android.util.Log.d("RuneSafeArea", "Metrics unchanged, skipping update")
            return
        }

        android.util.Log.d("RuneSafeArea", "Metrics changed or forced. New insets: top=${newMetrics.insets.top}, right=${newMetrics.insets.right}, bottom=${newMetrics.insets.bottom}, left=${newMetrics.insets.left}")
        lastMetrics = newMetrics
        publishMetricsToJS(newMetrics)
    }

    private fun publishMetricsToJS(metrics: WindowMetrics) {
        // FIXME: Publishing metrics via adapter.evaluate() causes the app to freeze
        // Need to find a safe way to update JS state after rendering has started
        android.util.Log.d("RuneSafeArea", "Would publish metrics: ${metrics.toJSON()}")
        
        // TODO: Use emitEvent or another mechanism that doesn't block rendering
        // runtime.emitEvent("safeAreaMetricsChanged", metrics.toJSON())
    }
    
    @Suppress("DEPRECATION")
    private fun convertInsetsToMetrics(insets: android.view.WindowInsets, view: View): WindowMetrics {
        val systemBars = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            insets.getInsetsIgnoringVisibility(android.view.WindowInsets.Type.systemBars())
        } else {
            android.graphics.Insets.of(
                insets.systemWindowInsetLeft,
                insets.systemWindowInsetTop,
                insets.systemWindowInsetRight,
                insets.systemWindowInsetBottom
            )
        }
        
        val width = view.width
        val height = view.height
        val density = view.resources.displayMetrics.density
        
        // Convert physical pixels to dp
        val topDp = systemBars.top / density
        val rightDp = systemBars.right / density
        val bottomDp = systemBars.bottom / density
        val leftDp = systemBars.left / density
        
        val widthDp = width / density
        val heightDp = height / density
        
        return WindowMetrics(
            insets = SafeAreaInsets(
                top = topDp,
                right = rightDp,
                bottom = bottomDp,
                left = leftDp
            ),
            frame = SafeAreaFrame(
                x = leftDp,
                y = topDp,
                width = widthDp - leftDp - rightDp,
                height = heightDp - topDp - bottomDp
            )
        )
    }
    
    private fun evaluateJavaScript(code: String) {
        // Ensure we're on the main thread for Hermes
        if (android.os.Looper.myLooper() != android.os.Looper.getMainLooper()) {
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                evaluateJavaScript(code)
            }
            return
        }
        
        try {
            android.util.Log.d("RuneSafeArea", "Evaluating JavaScript (${code.length} chars) on main thread")
            
            // Use reflection to access the adapter directly
            val adapterField = runtime.javaClass.getDeclaredField("adapter")
            adapterField.isAccessible = true
            val adapter = adapterField.get(runtime)
            
            android.util.Log.d("RuneSafeArea", "Got adapter: ${adapter?.javaClass?.simpleName}")
            
            val evaluateMethod = adapter?.javaClass?.getMethod("evaluate", String::class.java)
            evaluateMethod?.invoke(adapter, code)
            
            android.util.Log.d("RuneSafeArea", "JavaScript evaluation completed successfully")
        } catch (e: Exception) {
            android.util.Log.e("RuneSafeArea", "Failed to evaluate JavaScript: ${e.message}", e)
            e.printStackTrace()
        }
    }

    // MARK: - Data Models

    private data class WindowMetrics(
        val insets: SafeAreaInsets,
        val frame: SafeAreaFrame
    ) {
        fun toJSON(): String {
            return JSONObject().apply {
                put("insets", insets.toJSONObject())
                put("frame", frame.toJSONObject())
            }.toString()
        }
    }

    private data class SafeAreaInsets(
        val top: Float,
        val right: Float,
        val bottom: Float,
        val left: Float
    ) {
        fun toJSONObject(): JSONObject {
            return JSONObject().apply {
                put("top", top.toDouble())
                put("right", right.toDouble())
                put("bottom", bottom.toDouble())
                put("left", left.toDouble())
            }
        }
    }

    private data class SafeAreaFrame(
        val x: Float,
        val y: Float,
        val width: Float,
        val height: Float
    ) {
        fun toJSONObject(): JSONObject {
            return JSONObject().apply {
                put("x", x.toDouble())
                put("y", y.toDouble())
                put("width", width.toDouble())
                put("height", height.toDouble())
            }
        }
    }
}
