package dev.zynth.apis

import android.content.Context
import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import com.zynth.kit.core.ZynthRootView
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject

private const val BACK_PRESS_EVENT = "zynth.android.backPress"

class BackHandlerModule(
    private val runtime: ZynthRuntime,
    private val rootView: ZynthRootView,
) : ZynthModule {

    override val name: String = "BackHandler"

    override val exportedMethods: List<String> = listOf("setCanGoBack")

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

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "setCanGoBack" -> {
                val params = args.nestedAt(0)
                canGoBack = params.getBoolean("canGoBack", false)
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
