package com.rune.androidrouter

import android.graphics.Color

data class RouterBottomSheetNavigatorConfig(
    val navigatorId: String,
    val initialRouteName: String?,
    val options: RouterBottomSheetOptions?,
    val screens: List<RouterBottomSheetScreen>,
)

data class RouterBottomSheetScreen(
    val name: String,
    val options: RouterBottomSheetOptions?,
)

data class RouterBottomSheetOptions(
    val snapPoints: List<RouterBottomSheetSnapPoint>?,
    val initialSnapIndex: Int?,
    val overlayColor: Int?,
    val overlayOpacity: Float?,
    val dismissOnOverlayPress: Boolean?,
    val enableDynamicSizing: Boolean?,
    val enablePanningGesture: Boolean?,
    val allowDismissOnInteraction: Boolean?,
    val allowBackgroundInteraction: Boolean?,
    val preferredDetent: Int?, // Using Int index for now, could be complex logic
)

sealed class RouterBottomSheetSnapPoint {
    data class Absolute(val value: Float) : RouterBottomSheetSnapPoint()
    data class Percent(val value: Float) : RouterBottomSheetSnapPoint()

    companion object {
        fun from(input: Any?): RouterBottomSheetSnapPoint? {
            return when (input) {
                is Number -> Absolute(input.toFloat())
                is String -> parsePercent(input)
                else -> null
            }
        }

        private fun parsePercent(value: String): RouterBottomSheetSnapPoint? {
            val trimmed = value.trim()
            if (!trimmed.endsWith("%")) {
                return null
            }
            val numeric = trimmed.dropLast(1).toFloatOrNull() ?: return null
            return Percent(numeric / 100f)
        }
    }
}

object RouterBottomSheetParser {
    fun optionsFromMap(map: Map<String, Any?>?): RouterBottomSheetOptions? {
        if (map == null) return null
        val snapPoints = parseSnapPoints(map["snapPoints"])
        val initialIndex = map["initialSnapIndex"].asInt()
        val overlayColor = parseColor(map["overlayColor"])
        val overlayOpacity = map["overlayOpacity"].asFloat()
        val dismissOnOverlayPress = map["dismissOnOverlayPress"].asBoolean()
        val enableDynamicSizing = map["enableDynamicSizing"].asBoolean()
        val enablePanningGesture = map["enablePanningGesture"].asBoolean()
        val allowDismissOnInteraction = map["allowDismissOnInteraction"].asBoolean()
        val allowBackgroundInteraction = map["allowBackgroundInteraction"].asBoolean()
        val preferredDetent = map["preferredDetent"].asInt()

        if (
            snapPoints == null &&
            initialIndex == null &&
            overlayColor == null &&
            overlayOpacity == null &&
            dismissOnOverlayPress == null &&
            enableDynamicSizing == null &&
            enablePanningGesture == null &&
            allowDismissOnInteraction == null &&
            allowBackgroundInteraction == null &&
            preferredDetent == null
        ) {
            return null
        }
        return RouterBottomSheetOptions(
            snapPoints = snapPoints,
            initialSnapIndex = initialIndex,
            overlayColor = overlayColor,
            overlayOpacity = overlayOpacity,
            dismissOnOverlayPress = dismissOnOverlayPress,
            enableDynamicSizing = enableDynamicSizing,
            enablePanningGesture = enablePanningGesture,
            allowDismissOnInteraction = allowDismissOnInteraction,
            allowBackgroundInteraction = allowBackgroundInteraction,
            preferredDetent = preferredDetent,
        )
    }

    fun screensFromList(value: List<Any?>?): List<RouterBottomSheetScreen> {
        if (value == null) return emptyList()
        return value.mapNotNull { entry ->
            val data = entry.asMap()
            val name = data?.get("name") as? String ?: return@mapNotNull null
            val sheetOptions = optionsFromMap(data["sheet"].asMap())
            RouterBottomSheetScreen(name, sheetOptions)
        }
    }

    private fun parseSnapPoints(value: Any?): List<RouterBottomSheetSnapPoint>? {
        val list = value.asList() ?: return null
        val parsed = list.mapNotNull { RouterBottomSheetSnapPoint.from(it) }
        return parsed.takeIf { it.isNotEmpty() }
    }

    private fun parseColor(value: Any?): Int? {
        val string = value as? String ?: return null
        return runCatching { Color.parseColor(string) }.getOrNull()
    }
}

private fun Any?.asBoolean(): Boolean? = when (this) {
    is Boolean -> this
    is Number -> this.toInt() != 0
    is String -> this.toBooleanStrictOrNull()
    else -> null
}

private fun Any?.asInt(): Int? = when (this) {
    is Number -> this.toInt()
    is String -> this.toDoubleOrNull()?.toInt()
    else -> null
}

private fun Any?.asFloat(): Float? = when (this) {
    is Number -> this.toFloat()
    is String -> this.toFloatOrNull()
    else -> null
}
