package dev.zynth.apis

import android.content.Context
import android.content.ContextWrapper
import android.util.Log
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.zynth.kit.core.ZynthRootView
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import com.zynth.kit.runtime.ZynthSyncModule
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject

private const val APP_STATE_EVENT = "zynth.appstate.change"

class AppStateModule(
    private val runtime: ZynthRuntime,
    private val rootView: ZynthRootView,
    private val ownerHint: LifecycleOwner? = null,
) : ZynthModule, ZynthSyncModule, DefaultLifecycleObserver {

    override val name: String = "AppState"

    override val exportedMethods: List<String> = listOf("current")

    @Volatile
    private var currentState: String = "active"
    private var lifecycleOwner: LifecycleOwner? = null
    private var wasResumed: Boolean = false

    override val constants: Map<String, Any>?
        get() {
            currentState = resolveCurrentState()
            return mapOf("state" to currentState)
        }

    override fun initialize() {
        lifecycleOwner = ownerHint ?: findHostLifecycleOwner(rootView.context) ?: ProcessLifecycleOwner.get()
        
        // Observe both the specific activity (if available) and the process
        lifecycleOwner?.lifecycle?.addObserver(this)
        if (lifecycleOwner !== ProcessLifecycleOwner.get()) {
            ProcessLifecycleOwner.get().lifecycle.addObserver(this)
        }

        currentState = resolveCurrentState()
        
        // Post a check to catch the startup transition (Created -> Resumed)
        rootView.post {
            checkAndUpdate()
        }
        // Safety net: check again shortly after to ensure we catch the final settled state
        rootView.postDelayed({
            checkAndUpdate()
        }, 500)
    }

    override fun invalidate() {
        lifecycleOwner?.lifecycle?.removeObserver(this)
        if (lifecycleOwner !== ProcessLifecycleOwner.get()) {
            ProcessLifecycleOwner.get().lifecycle.removeObserver(this)
        }
        lifecycleOwner = null
    }

    override fun onStart(owner: LifecycleOwner) {
        checkAndUpdate()
    }

    override fun onResume(owner: LifecycleOwner) {
        checkAndUpdate()
    }

    override fun onPause(owner: LifecycleOwner) {
        checkAndUpdate()
    }

    override fun onStop(owner: LifecycleOwner) {
        checkAndUpdate()
    }

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "current" -> {
                checkAndUpdate()
                resultResponse(mapOf("state" to currentState))
            }
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any? {
        return when (method) {
            "current" -> {
                checkAndUpdate()
                mapOf("state" to currentState)
            }
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().put("result", result)
    }

    private fun checkAndUpdate() {
        val next = resolveCurrentState()
        updateState(next)
    }

    private fun resolveCurrentState(): String {
        val owner = lifecycleOwner
        val ownerState = owner?.lifecycle?.currentState ?: Lifecycle.State.DESTROYED
        val processState = ProcessLifecycleOwner.get().lifecycle.currentState

        // 1. If we have window focus or any state is RESUMED, we are ACTIVE.
        if (rootView.hasWindowFocus() || ownerState == Lifecycle.State.RESUMED || processState == Lifecycle.State.RESUMED) {
            wasResumed = true
            return "active"
        }

        // 2. If any state is STARTED, we are visible but not focused (INACTIVE).
        if (ownerState == Lifecycle.State.STARTED || processState == Lifecycle.State.STARTED) {
            return "inactive"
        }

        // 3. If we are at INITIALIZED or CREATED:
        // - If we have been resumed before, this is likely "background".
        // - If we have NEVER been resumed, this is "startup", so return "inactive".
        if (wasResumed) {
            return "background"
        }

        return "inactive"
    }

    private fun findHostLifecycleOwner(context: Context): LifecycleOwner? {
        var current: Context? = context
        while (current is ContextWrapper) {
            if (current is LifecycleOwner) {
                return current
            }
            current = current.baseContext
        }
        return null
    }

    private fun updateState(nextState: String) {
        if (currentState == nextState) {
            return
        }
        if (nextState == "active") {
            wasResumed = true
        }
        currentState = nextState
        runtime.emitEvent(APP_STATE_EVENT, mapOf("state" to currentState))
    }
}
