package dev.zynth.authsession

import android.app.Activity
import android.graphics.Color
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.zynth.kit.runtime.ZynthArgs
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import org.json.JSONObject
import java.net.URI

internal class AuthSessionModule(
  private val activity: Activity,
  private val runtime: ZynthRuntime,
) : ZynthModule, DefaultLifecycleObserver {
  override val name: String = "AuthSession"

  override val exportedMethods: List<String> = listOf(
    "openAuthSession",
    "completeAuthSession",
    "dismissAuthSession",
  )

  override val protectedMethods: List<String> = listOf(
    "openAuthSession",
    "completeAuthSession",
    "dismissAuthSession",
  )

  private var pending: PendingSession? = null
  private var lastIntentUrl: String? = null
  private var awaitingBrowserReturn: Boolean = false

  init {
    val owner = activity as? LifecycleOwner
    owner?.lifecycle?.addObserver(this)
  }

  override fun invalidate() {
    pending = null
    awaitingBrowserReturn = false
  }

  override fun onPause(owner: LifecycleOwner) {
    if (pending != null) {
      awaitingBrowserReturn = true
    }
  }

  override fun onResume(owner: LifecycleOwner) {
    if (pending == null || !awaitingBrowserReturn) {
      return
    }

    val currentUrl = activity.intent?.dataString
    if (currentUrl != null && currentUrl != lastIntentUrl && tryComplete(currentUrl)) {
      lastIntentUrl = currentUrl
      awaitingBrowserReturn = false
      return
    }

    val session = pending ?: return
    pending = null
    awaitingBrowserReturn = false
    emitResult(requestId = session.requestId, type = "cancel")
  }

  override fun call(method: String, args: ZynthArgs): JSONObject {
    return when (method) {
      "openAuthSession" -> openAuthSession(args)
      "completeAuthSession" -> completeAuthSession(args)
      "dismissAuthSession" -> dismissAuthSession()
      else -> throw IllegalArgumentException("Unsupported method: $method")
    }
  }

  private fun openAuthSession(args: ZynthArgs): JSONObject {
    if (pending != null) {
      throw IllegalStateException("Another auth session is already active")
    }

    val requestId = args.getString("requestId")
    val request = args.getMap("request")
    val authUrl = parseHttpsUri(readRequired(request, "authUrl"))
    val redirectUri = parseRedirectUri(readRequired(request, "redirectUri"))

    val builder = CustomTabsIntent.Builder()
    readString(request, "toolbarColor")?.let { color ->
      runCatching {
        builder.setDefaultColorSchemeParams(
          CustomTabColorSchemeParams.Builder()
            .setToolbarColor(Color.parseColor(color))
            .build()
        )
      }
    }

    val customTabsIntent = builder.build()
    pending = PendingSession(requestId = requestId, redirectUri = redirectUri)
    awaitingBrowserReturn = false
    customTabsIntent.launchUrl(activity, android.net.Uri.parse(authUrl.toString()))

    return JSONObject().put("status", "pending")
  }

  private fun completeAuthSession(args: ZynthArgs): JSONObject {
    val callbackUrl = args.getString("url")
    val completed = tryComplete(callbackUrl)
    return JSONObject().put("completed", completed)
  }

  private fun dismissAuthSession(): JSONObject {
    val session = pending ?: return JSONObject().put("dismissed", false)
    pending = null
    awaitingBrowserReturn = false
    emitResult(requestId = session.requestId, type = "dismiss")
    return JSONObject().put("dismissed", true)
  }

  private fun tryComplete(url: String): Boolean {
    val session = pending ?: return false
    val callback = runCatching { URI(url) }.getOrNull() ?: return false
    if (!matchesRedirect(session.redirectUri, callback)) {
      return false
    }

    pending = null
    awaitingBrowserReturn = false
    emitResult(
      requestId = session.requestId,
      type = "success",
      url = callback.toString(),
    )
    return true
  }

  private fun parseHttpsUri(raw: String): URI {
    val value = raw.trim()
    if (value.isEmpty()) {
      throw IllegalArgumentException("authUrl cannot be empty")
    }
    if (value.length > 4096) {
      throw IllegalArgumentException("authUrl exceeds maximum length")
    }
    val uri = URI(value)
    if (uri.scheme?.lowercase() != "https") {
      throw IllegalArgumentException("authUrl must use https")
    }
    if (uri.host.isNullOrBlank()) {
      throw IllegalArgumentException("authUrl must include a host")
    }
    return uri
  }

  private fun parseRedirectUri(raw: String): URI {
    val value = raw.trim()
    if (value.isEmpty()) {
      throw IllegalArgumentException("redirectUri cannot be empty")
    }
    if (value.length > 4096) {
      throw IllegalArgumentException("redirectUri exceeds maximum length")
    }
    val uri = URI(value)
    if (uri.scheme.isNullOrBlank()) {
      throw IllegalArgumentException("redirectUri must include a scheme")
    }
    return uri
  }

  private fun matchesRedirect(expected: URI, actual: URI): Boolean {
    val expectedScheme = expected.scheme?.lowercase() ?: return false
    val actualScheme = actual.scheme?.lowercase() ?: return false
    if (expectedScheme != actualScheme) {
      return false
    }

    val expectedHost = expected.host.orEmpty().lowercase()
    val actualHost = actual.host.orEmpty().lowercase()
    if (expectedHost.isNotEmpty() || actualHost.isNotEmpty()) {
      if (expectedHost != actualHost) {
        return false
      }
    }

    val expectedPath = expected.path.orEmpty()
    val actualPath = actual.path.orEmpty()
    return expectedPath == actualPath
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
    runtime.emitEvent("AuthSession.result", payload)
  }

  private fun readRequired(map: Map<String, Any?>, key: String): String {
    val value = map[key]
    if (value !is String || value.isBlank()) {
      throw IllegalArgumentException("$key must be a non-empty string")
    }
    return value
  }

  private fun readString(map: Map<String, Any?>, key: String): String? {
    val value = map[key] ?: return null
    return value as? String
  }

  private data class PendingSession(
    val requestId: String,
    val redirectUri: URI,
  )
}
