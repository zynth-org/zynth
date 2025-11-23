package dev.rune.{{MODULE_NAME}}

import android.app.Activity
import android.util.Log
import com.rune.kit.runtime.RuneRuntime

class {{MODULE_NAME_PASCAL}}Module(
    private val activity: Activity,
    private val runtime: RuneRuntime
) {
    private var lastState: ModuleState? = null

    init {
        registerBridge()
        startObserving()
    }

    fun onDestroy() {
        // TODO: remove observers if needed
    }

    private fun registerBridge() {
        runtime.installModules(listOf({{MODULE_NAME_PASCAL}}Bridge(this)))
    }

    private fun startObserving() {
        // TODO: add listeners/observers here
        updateState(force = true)
    }

    fun getInitialState(): ModuleState {
        return lastState ?: getCurrentState()
    }

    private fun getCurrentState(): ModuleState {
        // TODO: implement your state calculation logic
        return ModuleState(
            value = 0,
            status = "active",
            timestamp = System.currentTimeMillis()
        )
    }

    private fun updateState(force: Boolean) {
        val newState = getCurrentState()
        if (!force && newState == lastState) {
            return
        }
        lastState = newState
        publishState(newState)
    }

    private fun publishState(state: ModuleState) {
        runtime.emitEvent("{{MODULE_NAME_PASCAL}}:change", state.toMap())
    }

    data class ModuleState(
        val value: Int,
        val status: String,
        val timestamp: Long
    ) {
        fun toMap(): Map<String, Any> {
            return mapOf(
                "value" to value,
                "status" to status,
                "timestamp" to timestamp
            )
        }
    }
}
