package dev.rune.keyboard

import com.rune.kit.components.RuneComponentDescriptor
import org.json.JSONException
import org.json.JSONTokener
import org.json.JSONObject

object RuneKeyboardStickyViewDescriptor {
    fun create(): RuneComponentDescriptor {
        return RuneComponentDescriptor(
            type = "rune-keyboard-sticky-view",
            createView = { context, _ -> RuneKeyboardStickyView(context) },
            onNodeCreated = { _, _ -> },
            applyProperty = { node, name, value ->
                val view = node.view as? RuneKeyboardStickyView ?: return@RuneComponentDescriptor false
                when (name) {
                    "offset" -> {
                        parseFloat(value)?.let { view.setOffset(it) }
                        true
                    }
                    else -> false
                }
            },
            onReset = { node ->
                (node.view as? RuneKeyboardStickyView)?.cleanup()
            }
        )
    }

    private fun parseFloat(value: String?): Float? {
        val parsed = parsePrimitive(value) ?: return null
        return when (parsed) {
            is Number -> parsed.toFloat()
            is String -> parsed.toFloatOrNull()
            else -> null
        }
    }

    private fun parsePrimitive(value: String?): Any? {
        if (value.isNullOrBlank() || value == "null") return null
        return try {
            val token = JSONTokener(value.trim()).nextValue()
            if (token === JSONObject.NULL) null else token
        } catch (_: JSONException) {
            value.trim().trim('"')
        }
    }
}
