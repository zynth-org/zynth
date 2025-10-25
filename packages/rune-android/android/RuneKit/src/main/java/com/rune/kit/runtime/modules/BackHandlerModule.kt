package com.rune.kit.runtime.modules

import android.content.Context
import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import com.rune.kit.core.RuneRootView
import com.rune.kit.runtime.RuneModule
import com.rune.kit.runtime.RuneRuntime
import org.json.JSONObject

private const val BACK_PRESS_EVENT = "rune.android.backPress"

class BackHandlerModule(
    private val runtime: RuneRuntime,
    private val rootView: RuneRootView,
) : RuneModule {

    override val name: String = "BackHandler"

    private var callback: OnBackPressedCallback? = null
    @Volatile private var canGoBack: Boolean = false

    override fun initialize() {
        val activity = findHostActivity(rootView.context) ?: return
        val dispatcher = activity.onBackPressedDispatcher

        callback = object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!canGoBack) {
                    // Let the system handle the back press when JS can't navigate.
                    isEnabled = false
                    dispatcher.onBackPressed()
                    isEnabled = true
                    return
                }
                runtime.emitEvent(BACK_PRESS_EVENT, mapOf("source" to "hardware"))
            }
        }.also { dispatcher.addCallback(activity, it) }
    }

    override fun invalidate() {
        callback?.remove()
        callback = null
    }

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "setCanGoBack" -> {
                val payload = args.firstOrNull()
                canGoBack = when (payload) {
                    is JSONObject -> payload.optBoolean("canGoBack", false)
                    is Map<*, *> -> (payload["canGoBack"] as? Boolean) ?: false
                    else -> false
                }
                JSONObject().put("ok", true)
            }
            else -> JSONObject().put("error", "unknown_method")
        }
    }

    private fun findHostActivity(context: Context): ComponentActivity? {
        var current: Context? = context
        while (current is ContextWrapper) {
            if (current is ComponentActivity) {
                return current
            }
            current = current.baseContext
        }
        return null
    }
}
