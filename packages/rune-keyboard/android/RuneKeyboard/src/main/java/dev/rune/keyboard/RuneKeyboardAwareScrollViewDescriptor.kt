package dev.rune.keyboard

import com.rune.kit.components.RuneComponentDescriptor
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

object RuneKeyboardAwareScrollViewDescriptor {
    fun create(): RuneComponentDescriptor {
        return RuneComponentDescriptor(
            type = "rune-keyboard-aware-scroll-view",
            createView = { context, _ -> RuneKeyboardAwareScrollView(context) },
            onNodeCreated = { _, _ -> },
            applyProperty = { node, name, value ->
                val view = node.view as? RuneKeyboardAwareScrollView ?: return@RuneComponentDescriptor false
                when (name) {
                    "scrollEnabled" -> {
                        parseBoolean(value)?.let { view.setScrollEnabled(it) }
                        true
                    }
                    "showsVerticalScrollIndicator" -> {
                        parseBoolean(value)?.let { view.setShowsVerticalScrollIndicator(it) }
                        true
                    }
                    "showsHorizontalScrollIndicator" -> {
                        parseBoolean(value)?.let { view.setShowsHorizontalScrollIndicator(it) }
                        true
                    }
                    "bounces" -> {
                        parseBoolean(value)?.let { view.setBounces(it) }
                        true
                    }
                    "contentInset" -> {
                        parseObject(value)?.let { view.setContentInset(it) }
                        true
                    }
                    "extraScrollHeight" -> {
                        parseFloat(value)?.let { view.setExtraScrollHeight(it) }
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
                    "scrollToInputOnFocus" -> {
                        parseBoolean(value)?.let { view.setScrollToInputOnFocus(it) }
                        true
                    }
                    else -> false
                }
            },
            onReset = { node ->
                (node.view as? RuneKeyboardAwareScrollView)?.cleanup()
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

    private fun parseObject(value: String?): Map<String, Any>? {
        if (value.isNullOrBlank() || value == "null") return null
        return try {
            val json = JSONObject(value.trim())
            val map = mutableMapOf<String, Any>()
            json.keys().forEach { key ->
                json.opt(key)?.let { map[key] = it }
            }
            map
        } catch (_: JSONException) {
            null
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
