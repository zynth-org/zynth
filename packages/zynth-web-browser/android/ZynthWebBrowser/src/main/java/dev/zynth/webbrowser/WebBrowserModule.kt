package dev.zynth.webbrowser

import android.app.Activity
import android.content.ActivityNotFoundException
import android.graphics.Color
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import com.zynth.kit.runtime.ZynthArgs
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import org.json.JSONObject
import java.net.URI

internal class WebBrowserModule(
  private val activity: Activity,
  private val runtime: ZynthRuntime,
) : ZynthModule {
  override val name: String = "WebBrowser"
  override val exportedMethods: List<String> = listOf(
    "openBrowserAsync",
    "dismissBrowser",
    "warmUpAsync",
    "coolDownAsync",
  )

  override fun call(method: String, args: ZynthArgs): JSONObject {
    return when (method) {
      "openBrowserAsync" -> openBrowserAsync(args)
      "dismissBrowser" -> JSONObject().put("dismissed", false)
      "warmUpAsync" -> JSONObject().put("warmedUp", true)
      "coolDownAsync" -> JSONObject().put("cooledDown", true)
      else -> throw IllegalArgumentException("Unsupported method: $method")
    }
  }

  private fun openBrowserAsync(args: ZynthArgs): JSONObject {
    val requestId = args.getString("requestId")
    val options = args.getMap("options")
    val url = readString(options, "url")
    val uri = parseHttpUri(url)

    val builder = CustomTabsIntent.Builder()
    readString(options, "toolbarColor")?.let { color ->
      runCatching {
        builder.setDefaultColorSchemeParams(
          CustomTabColorSchemeParams.Builder()
            .setToolbarColor(Color.parseColor(color))
            .build()
        )
      }
    }

    val customTabsIntent = builder.build().apply {
      intent.addFlags(if (readBoolean(options, "createTask", false)) android.content.Intent.FLAG_ACTIVITY_NEW_TASK else 0)
    }

    return try {
      customTabsIntent.launchUrl(activity, android.net.Uri.parse(uri.toString()))
      emitResult(
        requestId = requestId,
        type = "opened",
        url = uri.toString(),
      )
      JSONObject().put("status", "opened")
    } catch (_: ActivityNotFoundException) {
      emitResult(
        requestId = requestId,
        type = "error",
        errorCode = "E_ACTIVITY_NOT_FOUND",
        errorMessage = "No browser activity found to handle Custom Tabs intent",
      )
      JSONObject().put("status", "error")
    }
  }

  private fun parseHttpUri(raw: String?): URI {
    val value = raw?.trim().orEmpty()
    if (value.isEmpty()) {
      throw IllegalArgumentException("WebBrowser URL cannot be empty")
    }
    if (value.length > 4096) {
      throw IllegalArgumentException("WebBrowser URL exceeds maximum length")
    }
    val uri = URI(value)
    val scheme = uri.scheme?.lowercase()
    if (scheme != "http" && scheme != "https") {
      throw IllegalArgumentException("WebBrowser URL must use http or https")
    }
    if (uri.host.isNullOrBlank()) {
      throw IllegalArgumentException("WebBrowser URL must include a host")
    }
    return uri
  }

  private fun readString(map: Map<String, Any?>, key: String): String? {
    val value = map[key] ?: return null
    return value as? String
  }

  private fun readBoolean(map: Map<String, Any?>, key: String, fallback: Boolean): Boolean {
    val value = map[key] ?: return fallback
    return value as? Boolean ?: fallback
  }

  private fun emitResult(
    requestId: String,
    type: String,
    url: String? = null,
    errorCode: String? = null,
    errorMessage: String? = null,
  ) {
    val payload = JSONObject()
      .put("requestId", requestId)
      .put("type", type)
      .put("url", url ?: JSONObject.NULL)
      .put("errorCode", errorCode ?: JSONObject.NULL)
      .put("errorMessage", errorMessage ?: JSONObject.NULL)
    runtime.emitEvent("WebBrowser.result", payload)
  }
}
