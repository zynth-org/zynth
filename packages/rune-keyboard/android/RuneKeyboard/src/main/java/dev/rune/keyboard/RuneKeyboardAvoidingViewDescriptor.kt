package dev.rune.keyboard

import com.rune.kit.components.RuneComponentDescriptor
import org.json.JSONException
import org.json.JSONTokener
import org.json.JSONObject

object RuneKeyboardAvoidingViewDescriptor {
    fun create(): RuneComponentDescriptor {
        return RuneComponentDescriptor(
            type = "rune-keyboard-avoiding-view",
            createView = { context, _ -> RuneKeyboardAvoidingView(context) },
            onNodeCreated = { _, _ -> },
            applyProperty = { node, name, value ->
                val view = node.view as? RuneKeyboardAvoidingView ?: return@RuneComponentDescriptor false
                when (name) {
                    "behavior" -> {
                        parseString(value)?.let { view.setBehavior(it) }
                        true
                    }
                    "keyboardVerticalOffset" -> {
                        parseFloat(value)?.let { view.setKeyboardVerticalOffset(it) }
                        true
                    }
                    "enabled" -> {
                        parseBoolean(value)?.let { view.setKeyboardEnabled(it) }
                        true
                    }
                    else -> false
                }
            },
            onReset = { node ->
                (node.view as? RuneKeyboardAvoidingView)?.cleanup()
            }
        )
    }

    private fun parseString(value: String?): String? {
        val parsed = parsePrimitive(value) ?: return null
        return parsed as? String
    }

    private fun parseFloat(value: String?): Float? {
        val parsed = parsePrimitive(value) ?: return null
        return when (parsed) {
            is Number -> parsed.toFloat()
            is String -> parsed.toFloatOrNull()
            else -> null
        }
    }

    private fun parseBoolean(value: String?): Boolean? {
        val parsed = parsePrimitive(value) ?: return null
        return when (parsed) {
            is Boolean -> parsed
            is String -> {
                when (parsed.lowercase()) {
                    "true" -> true
                    "false" -> false
                    else -> null
                }
            }
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
