package dev.zynth.ui

import android.app.Activity
import android.content.ComponentCallbacks
import android.content.res.Configuration
import com.zynth.kit.runtime.ZynthRuntime

class ZynthAppearanceModule(
    private val activity: Activity,
    private val runtime: ZynthRuntime
) {
    private var lastState: AppearanceState? = null
    private var callbacks: ComponentCallbacks? = null

    init {
        registerBridge()
        startObserving()
    }

    fun onDestroy() {
        stopObserving()
    }

    private fun registerBridge() {
        android.util.Log.d("ZynthAppearance", "registerBridge")
        runtime.installModules(listOf(ZynthAppearanceBridge(this)))
    }

    private fun startObserving() {
        android.util.Log.d("ZynthAppearance", "startObserving")
        val observer = object : ComponentCallbacks {
            override fun onConfigurationChanged(newConfig: Configuration) {
                android.util.Log.d("ZynthAppearance", "configurationChanged uiMode=${newConfig.uiMode}")
                updateState(newConfig, force = false)
            }

            override fun onLowMemory() = Unit
        }
        callbacks = observer
        activity.registerComponentCallbacks(observer)
        updateState(activity.resources.configuration, force = true)
    }

    private fun stopObserving() {
        callbacks?.let { activity.unregisterComponentCallbacks(it) }
        callbacks = null
    }

    fun getInitialState(): AppearanceState {
        return lastState ?: getCurrentState(activity.resources.configuration)
    }

    fun getCurrentState(config: Configuration = activity.resources.configuration): AppearanceState {
        return AppearanceState(colorScheme = resolveScheme(config))
    }

    private fun resolveScheme(config: Configuration): String {
        val nightMode = config.uiMode and Configuration.UI_MODE_NIGHT_MASK
        return if (nightMode == Configuration.UI_MODE_NIGHT_YES) "dark" else "light"
    }

    private fun updateState(config: Configuration, force: Boolean) {
        val newState = getCurrentState(config)
        if (!force && newState == lastState) {
            return
        }
        android.util.Log.d("ZynthAppearance", "updateState colorScheme=${newState.colorScheme}")
        lastState = newState
        publishState(newState)
    }

    private fun publishState(state: AppearanceState) {
        android.util.Log.d("ZynthAppearance", "emit ZynthAppearance:change ${state.toMap()}")
        runtime.emitEvent("ZynthAppearance:change", state.toMap())
    }

    data class AppearanceState(
        val colorScheme: String
    ) {
        fun toMap(): Map<String, Any> {
            return mapOf(
                "colorScheme" to colorScheme
            )
        }
    }
}
