package com.rune.androidrouter

import android.graphics.Color
import android.util.Log

private const val COLOR_TAG = "RuneAndroidRouter"

internal fun parseColor(value: Any?): Int? {
    val candidate = when (value) {
        null -> return null
        is String -> value.trim().ifEmpty { return null }
        is Number -> String.format("#%06X", 0xFFFFFF and value.toInt())
        else -> value.toString()
    }
    return try {
        Color.parseColor(candidate)
    } catch (error: Throwable) {
        Log.w(COLOR_TAG, "Unable to parse color '$candidate'", error)
        null
    }
}

internal fun parseBoolean(value: Any?, default: Boolean): Boolean = when (value) {
    is Boolean -> value
    is String -> value.toBooleanStrictOrNull() ?: default
    is Number -> value.toInt() != 0
    else -> default
}

internal fun parseBadge(value: Any?): String? = when (value) {
    null -> null
    is String -> value.takeIf { it.isNotEmpty() }
    is Number -> value.toString()
    else -> value.toString()
}
