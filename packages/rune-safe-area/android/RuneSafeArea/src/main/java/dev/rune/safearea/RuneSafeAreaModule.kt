package dev.rune.safearea

import android.app.Activity
import android.content.res.Configuration
import android.view.View
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import dev.rune.core.RuneRuntime
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
        installJSInterface()
        attachToRootView()
    }

    // MARK: - Lifecycle

    fun onDestroy() {
        rootView = null
    }

    // MARK: - JS Interface

    private fun installJSInterface() {
        val code = """
            (function() {
              const listeners = [];
              let currentMetrics = null;
              
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
              
              console.log('[RuneSafeArea] Module installed');
            })();
        """.trimIndent()

        runtime.evaluate(code)
        
        // Provide initial metrics immediately
        updateMetrics(force = true)
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
        val view = rootView ?: return null
        val windowInsets = ViewCompat.getRootWindowInsets(view) ?: return null

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

        // Get view bounds
        val width = view.width
        val height = view.height

        // Calculate safe frame
        val safeFrame = SafeAreaFrame(
            x = combinedInsets.left.toFloat(),
            y = combinedInsets.top.toFloat(),
            width = (width - combinedInsets.left - combinedInsets.right).toFloat(),
            height = (height - combinedInsets.top - combinedInsets.bottom).toFloat()
        )

        return WindowMetrics(
            insets = SafeAreaInsets(
                top = combinedInsets.top.toFloat(),
                right = combinedInsets.right.toFloat(),
                bottom = combinedInsets.bottom.toFloat(),
                left = combinedInsets.left.toFloat()
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
        val newMetrics = getCurrentMetrics() ?: return

        // Skip if unchanged (unless forced)
        if (!force && lastMetrics == newMetrics) {
            return
        }

        lastMetrics = newMetrics
        publishMetricsToJS(newMetrics)
    }

    private fun publishMetricsToJS(metrics: WindowMetrics) {
        val metricsJSON = metrics.toJSON()
        val code = """
            (function() {
              if (globalThis.__RUNE_SAFE_AREA__) {
                globalThis.__RUNE_SAFE_AREA__._updateMetrics($metricsJSON);
              }
            })();
        """.trimIndent()

        runtime.evaluate(code)
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
