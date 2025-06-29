package com.rune.androidrouter

internal data class TabIconDescriptor(
    val systemName: String? = null,
    val assetName: String? = null,
    val uri: String? = null,
    val runeId: String? = null,
)

internal data class RouterTabOptions(
    val label: String? = null,
    val icon: TabIconDescriptor? = null,
    val badge: String? = null,
    val badgeColor: Int? = null,
    val activeTintColor: Int? = null,
    val inactiveTintColor: Int? = null,
    val tabBarVisible: Boolean? = null,
    val tabBarBackgroundColor: Int? = null,
    val tabBarIndicatorColor: Int? = null,
    val customTab: Boolean = false,
    ) {
        companion object {
            fun fromMap(map: Map<String, Any?>?): RouterTabOptions {
                if (map == null) return RouterTabOptions()
            val iconDescriptor = map["icon"].asMap()?.let { icon ->
                TabIconDescriptor(
                    systemName = icon["systemName"] as? String,
                    assetName = icon["assetName"] as? String,
                    uri = icon["uri"] as? String,
                    runeId = icon["runeId"] as? String,
                )
            }
            val badgeValue = parseBadge(map["badge"])
            val tabBarVisible = map["tabBarVisible"]?.let { parseBoolean(it, true) }
            return RouterTabOptions(
                label = map["label"] as? String,
                icon = iconDescriptor,
                badge = badgeValue,
                badgeColor = parseColor(map["badgeColor"]),
                activeTintColor = parseColor(map["activeTintColor"]),
                inactiveTintColor = parseColor(map["inactiveTintColor"]),
                tabBarVisible = tabBarVisible,
                tabBarBackgroundColor = parseColor(map["tabBarBackgroundColor"]),
                tabBarIndicatorColor = parseColor(map["tabBarIndicatorColor"]),
                customTab = parseBoolean(map["customTab"], false),
            )
            }
        }
    }

internal data class RouterTabBarOptions(
    val backgroundColor: Int? = null,
) {
    companion object {
        fun fromMap(map: Map<String, Any?>?): RouterTabBarOptions {
            if (map == null) return RouterTabBarOptions()
            val background = parseColor(map["backgroundColor"])
            return RouterTabBarOptions(backgroundColor = background)
        }
    }
}
