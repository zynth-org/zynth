package com.rune.androidrouter

import android.graphics.Color
import android.os.Bundle
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

private const val TAG = "RuneAndroidRouter"

data class RouterScreenOptions(
    val title: String? = null,
    val headerTintColor: Int? = null,
    val headerBackgroundColor: Int? = null,
    val headerShown: Boolean = true,
) {
    fun toBundle(): Bundle = Bundle().apply {
        putString(KEY_TITLE, title)
        headerTintColor?.let { putInt(KEY_HEADER_TINT, it) }
        headerBackgroundColor?.let { putInt(KEY_HEADER_BACKGROUND, it) }
        putBoolean(KEY_HEADER_SHOWN, headerShown)
    }

    companion object {
        private const val KEY_TITLE = "title"
        private const val KEY_HEADER_TINT = "headerTint"
        private const val KEY_HEADER_BACKGROUND = "headerBackground"
        private const val KEY_HEADER_SHOWN = "headerShown"

        fun fromBundle(bundle: Bundle?): RouterScreenOptions {
            if (bundle == null) return RouterScreenOptions()
            val hasTint = bundle.containsKey(KEY_HEADER_TINT)
            val hasBackground = bundle.containsKey(KEY_HEADER_BACKGROUND)
            return RouterScreenOptions(
                title = bundle.getString(KEY_TITLE),
                headerTintColor = if (hasTint) bundle.getInt(KEY_HEADER_TINT) else null,
                headerBackgroundColor = if (hasBackground) bundle.getInt(KEY_HEADER_BACKGROUND) else null,
                headerShown = bundle.getBoolean(KEY_HEADER_SHOWN, true),
            )
        }

        fun fromMap(map: Map<String, Any?>?): RouterScreenOptions {
            if (map == null) return RouterScreenOptions()
            val title = map["title"] as? String
            val headerShown = when (val shown = map["headerShown"]) {
                is Boolean -> shown
                is String -> shown.toBooleanStrictOrNull() ?: true
                else -> true
            }
            val tint = parseColor(map["headerTintColor"])
            val background = parseColor(map["headerBackgroundColor"])
            return RouterScreenOptions(
                title = title,
                headerTintColor = tint,
                headerBackgroundColor = background,
                headerShown = headerShown,
            )
        }

        private fun parseColor(value: Any?): Int? {
            val candidate = when (value) {
                null -> return null
                is String -> value.trim().ifEmpty { return null }
                is Number -> String.format("#%06X", 0xFFFFFF and value.toInt())
                else -> value.toString()
            }
            return try {
                Color.parseColor(candidate)
            } catch (t: Throwable) {
                Log.w(TAG, "Unable to parse color '$candidate'", t)
                null
            }
        }
    }
}

data class RouterScreenDefinition(
    val name: String,
    val options: RouterScreenOptions,
)

data class RouterScreenRequest(
    val routeName: String,
    val paramsJson: String?,
    val options: RouterScreenOptions,
) {
    fun toBundle(): Bundle = Bundle().apply {
        putString(ARG_ROUTE_NAME, routeName)
        putString(ARG_PARAMS_JSON, paramsJson)
        putBundle(ARG_OPTIONS, options.toBundle())
    }

    companion object {
        const val ARG_ROUTE_NAME = "routeName"
        const val ARG_PARAMS_JSON = "paramsJson"
        const val ARG_OPTIONS = "options"

        fun fromBundle(bundle: Bundle): RouterScreenRequest {
            val routeName = bundle.getString(ARG_ROUTE_NAME)
                ?: error("Route name missing in arguments")
            val params = bundle.getString(ARG_PARAMS_JSON)
            val options = RouterScreenOptions.fromBundle(bundle.getBundle(ARG_OPTIONS))
            return RouterScreenRequest(routeName, params, options)
        }
    }
}

internal fun Any?.asJSONObject(): JSONObject? = when (this) {
    null -> null
    is JSONObject -> this
    is Map<*, *> -> JSONObject().apply {
        for ((key, value) in this@asJSONObject) {
            if (key is String) {
                put(key, value.toJsonCompatible())
            }
        }
    }
    is String -> runCatching { JSONObject(this) }.getOrNull()
    else -> null
}

internal fun Any?.asList(): List<Any?>? = when (this) {
    null -> null
    is List<*> -> this
    is Array<*> -> this.toList()
    is JSONArray -> buildList {
        for (index in 0 until this@asList.length()) {
            add(this@asList.get(index))
        }
    }
    else -> null
}

internal fun Any?.asMap(): Map<String, Any?>? = when (this) {
    null -> null
    is Map<*, *> -> buildMap {
        for ((key, value) in this@asMap) {
            if (key is String) put(key, value)
        }
    }
    is JSONObject -> buildMap {
        val iterator = this@asMap.keys()
        while (iterator.hasNext()) {
            val key = iterator.next()
            put(key, this@asMap.get(key))
        }
    }
    else -> null
}

private fun Any?.toJsonCompatible(): Any? = when (this) {
    null -> JSONObject.NULL
    is JSONObject, is JSONArray, is Number, is Boolean, is String -> this
    is Map<*, *> -> JSONObject().apply {
        for ((key, value) in this@toJsonCompatible) {
            if (key is String) put(key, value.toJsonCompatible())
        }
    }
    is List<*> -> JSONArray().apply {
        for (item in this@toJsonCompatible) {
            put(item.toJsonCompatible())
        }
    }
    else -> this.toString()
}
