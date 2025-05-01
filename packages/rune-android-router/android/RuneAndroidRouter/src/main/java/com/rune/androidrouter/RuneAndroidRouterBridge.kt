package com.rune.androidrouter

import android.util.Log
import com.rune.kit.runtime.RuneModule
import org.json.JSONObject

internal class RuneAndroidRouterBridge(
    private val navigationContainer: RuneNavigationContainer,
) : RuneModule {

    override val name: String = "RuneAndroidRouter"

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "registerScreens" -> handleRegisterScreens(args)
            "reset" -> handleReset(args)
            "navigate" -> handleNavigate(args)
            "goBack" -> handleGoBack()
            "setOptions" -> handleSetOptions(args)
            "registerTabs" -> handleRegisterTabs(args)
            "switchTab" -> handleSwitchTab(args)
            "setTabOptions" -> handleSetTabOptions(args)
            else -> errorResponse(method, "unsupported_method")
        }
    }

    private fun handleRegisterScreens(args: Array<Any?>): JSONObject {
        Log.d(name, "handleRegisterScreens args=${args.contentToString()}")
        val payload = args.firstOrNull().asMap()
        val screens = payload?.get("screens").asList().orEmpty()
        val definitions = screens.mapNotNull { entry ->
            val data = entry.asMap() ?: return@mapNotNull null
            val name = data["name"] as? String ?: return@mapNotNull null
            val options = RouterScreenOptions.fromMap(data["options"].asMap())
            RouterScreenDefinition(name, options)
        }
        navigationContainer.registerScreens(definitions)
        return successResponse()
    }

    private fun handleReset(args: Array<Any?>): JSONObject {
        Log.d(name, "handleReset args=${args.contentToString()}")
        val payload = args.firstOrNull().asMap()
        val initialRoute = payload?.get("initialRouteName") as? String
        navigationContainer.reset(initialRoute)
        return successResponse()
    }

    private fun handleNavigate(args: Array<Any?>): JSONObject {
        Log.d(name, "handleNavigate args=${args.contentToString()}")
        val payload = args.firstOrNull().asMap() ?: return errorResponse("navigate", "invalid_payload")
        val routeName = payload["name"] as? String
            ?: return errorResponse("navigate", "missing_name")
        val params = payload["params"].asJSONObject()
        navigationContainer.navigate(routeName, params)
        return successResponse()
    }

    private fun handleGoBack(): JSONObject {
        Log.d(name, "handleGoBack")
        navigationContainer.goBack()
        return successResponse()
    }

    private fun handleSetOptions(args: Array<Any?>): JSONObject {
        Log.d(name, "handleSetOptions args=${args.contentToString()}")
        val payload = args.firstOrNull().asMap() ?: return errorResponse("setOptions", "invalid_payload")
        val options = RouterScreenOptions.fromMap(payload["options"].asMap())
        navigationContainer.applyOptions(options)
        return successResponse()
    }

    private fun handleRegisterTabs(args: Array<Any?>): JSONObject {
        Log.d(name, "handleRegisterTabs args=${args.contentToString()}")
        val payload = args.firstOrNull().asMap() ?: return errorResponse("registerTabs", "invalid_payload")
        val tabEntries = payload["tabs"].asList().orEmpty()
        val definitions = tabEntries.mapNotNull { entry ->
            val data = entry.asMap() ?: return@mapNotNull null
            val tabName = data["name"] as? String ?: return@mapNotNull null
            val screenOptions = RouterScreenOptions.fromMap(data["options"].asMap())
            val tabOptions = RouterTabOptions.fromMap(data["tab"].asMap())
            RouterTabDefinition(tabName, screenOptions, tabOptions)
        }
        val initialRoute = payload["initialRouteName"] as? String
        val tabBarOptions = RouterTabBarOptions.fromMap(payload["tabBarOptions"].asMap())
        navigationContainer.registerTabs(definitions, initialRoute, tabBarOptions)
        return successResponse()
    }

    private fun handleSwitchTab(args: Array<Any?>): JSONObject {
        Log.d(name, "handleSwitchTab args=${args.contentToString()}")
        val payload = args.firstOrNull().asMap() ?: return errorResponse("switchTab", "invalid_payload")
        val tabName = payload["name"] as? String ?: return errorResponse("switchTab", "missing_name")
        navigationContainer.switchTab(tabName)
        return successResponse()
    }

    private fun handleSetTabOptions(args: Array<Any?>): JSONObject {
        Log.d(name, "handleSetTabOptions args=${args.contentToString()}")
        val payload = args.firstOrNull().asMap() ?: return errorResponse("setTabOptions", "invalid_payload")
        val tabName = payload["name"] as? String ?: return errorResponse("setTabOptions", "missing_name")
        val tabOptions = RouterTabOptions.fromMap(payload["options"].asMap())
        navigationContainer.setTabOptions(tabName, tabOptions)
        return successResponse()
    }

    private fun successResponse(): JSONObject = JSONObject().put("ok", true)

    private fun errorResponse(method: String, reason: String): JSONObject {
        Log.w(name, "Method $method failed: $reason")
        return JSONObject()
            .put("ok", false)
            .put("error", reason)
    }
}
