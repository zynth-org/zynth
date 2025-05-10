package com.rune.androidrouter

import android.os.Bundle
import org.json.JSONArray
import org.json.JSONObject

enum class RouterScreenPresentation(val value: String) {
    PUSH("push"),
    MODAL("modal");

    companion object {
        fun from(value: String?): RouterScreenPresentation {
            val stringValue = value?.trim()?.lowercase()
            if (stringValue == null || stringValue.isEmpty()) {
                return PUSH
            }
            return values().firstOrNull { it.value == stringValue } ?: PUSH
        }
    }
}

data class RouterScreenOptions(
    val title: String? = null,
    val subtitle: String? = null,
    val largeTitle: Boolean = false,
    val headerShown: Boolean = true,
    val headerTintColor: Int? = null,
    val headerBackgroundColor: Int? = null,
    val headerTransparent: Boolean = false,
    val headerShadowVisible: Boolean = true,
    val presentation: RouterScreenPresentation = RouterScreenPresentation.PUSH,
) {
    fun toBundle(): Bundle = Bundle().apply {
        putString(KEY_TITLE, title)
        putString(KEY_SUBTITLE, subtitle)
        putBoolean(KEY_LARGE_TITLE, largeTitle)
        putBoolean(KEY_HEADER_SHOWN, headerShown)
        headerTintColor?.let { putInt(KEY_HEADER_TINT, it) }
        headerBackgroundColor?.let { putInt(KEY_HEADER_BACKGROUND, it) }
        putBoolean(KEY_HEADER_TRANSPARENT, headerTransparent)
        putBoolean(KEY_HEADER_SHADOW_VISIBLE, headerShadowVisible)
        putString(KEY_PRESENTATION, presentation.value)
    }

    companion object {
        private const val KEY_TITLE = "title"
        private const val KEY_SUBTITLE = "subtitle"
        private const val KEY_LARGE_TITLE = "largeTitle"
        private const val KEY_HEADER_SHOWN = "headerShown"
        private const val KEY_HEADER_TINT = "headerTint"
        private const val KEY_HEADER_BACKGROUND = "headerBackground"
        private const val KEY_HEADER_TRANSPARENT = "headerTransparent"
        private const val KEY_HEADER_SHADOW_VISIBLE = "headerShadowVisible"
        private const val KEY_PRESENTATION = "presentation"

        fun fromBundle(bundle: Bundle?): RouterScreenOptions {
            if (bundle == null) return RouterScreenOptions()
            val hasTint = bundle.containsKey(KEY_HEADER_TINT)
            val hasBackground = bundle.containsKey(KEY_HEADER_BACKGROUND)
            return RouterScreenOptions(
                title = bundle.getString(KEY_TITLE),
                subtitle = bundle.getString(KEY_SUBTITLE),
                largeTitle = bundle.getBoolean(KEY_LARGE_TITLE, false),
                headerShown = bundle.getBoolean(KEY_HEADER_SHOWN, true),
                headerTintColor = if (hasTint) bundle.getInt(KEY_HEADER_TINT) else null,
                headerBackgroundColor = if (hasBackground) bundle.getInt(KEY_HEADER_BACKGROUND) else null,
                headerTransparent = bundle.getBoolean(KEY_HEADER_TRANSPARENT, false),
                headerShadowVisible = bundle.getBoolean(KEY_HEADER_SHADOW_VISIBLE, true),
                presentation = RouterScreenPresentation.from(bundle.getString(KEY_PRESENTATION)),
            )
        }

        fun fromMap(map: Map<String, Any?>?): RouterScreenOptions {
            if (map == null) return RouterScreenOptions()
            val title = map["title"] as? String
            val subtitle = map["subtitle"] as? String
            val largeTitle = parseBoolean(map["largeTitle"], false)
            val headerShown = parseBoolean(map["headerShown"], true)
            val headerTransparent = parseBoolean(map["headerTransparent"], false)
            val headerShadowVisible = parseBoolean(map["headerShadowVisible"], true)
            val tint = parseColor(map["headerTintColor"])
            val background = parseColor(map["headerBackgroundColor"])
            return RouterScreenOptions(
                title = title,
                subtitle = subtitle,
                largeTitle = largeTitle,
                headerShown = headerShown,
                headerTintColor = tint,
                headerBackgroundColor = background,
                headerTransparent = headerTransparent,
                headerShadowVisible = headerShadowVisible,
                presentation = RouterScreenPresentation.from(
                    map["presentation"]?.toString()
                ),
            )
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

private fun Any?.asBoolean(default: Boolean): Boolean = when (this) {
    is Boolean -> this
    is String -> this.toBooleanStrictOrNull() ?: default
    is Number -> this.toInt() != 0
    else -> default
}
