package com.rune.kit.dev

import java.io.IOException
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import kotlin.math.max

data class RuneDevBundle(
  val code: String,
  val url: HttpUrl,
)

object RuneDevBundleFetcher {
  private val client: OkHttpClient = OkHttpClient.Builder()
    .retryOnConnectionFailure(true)
    .build()

  private fun buildBundleUrl(base: HttpUrl, token: String?): HttpUrl {
    val builder = base.newBuilder()
      .encodedPath("/main.js")
    sanitizeToken(token)?.let { value ->
      builder.removeAllQueryParameters("token")
      builder.addQueryParameter("token", value)
    }
    return builder.build()
  }

  @Throws(IOException::class)
  fun fetch(
    baseUrl: String,
    token: String? = null,
    attempts: Int = 8,
    retryDelayMs: Long = 750,
  ): RuneDevBundle {
    val httpUrl = baseUrl.toHttpUrlOrNull()
      ?: throw IOException("Invalid dev server URL: $baseUrl")
    val requestUrl = buildBundleUrl(httpUrl, token)
    var lastError: IOException? = null

    repeat(max(attempts, 1)) { index ->
      try {
        return fetchOnce(requestUrl)
      } catch (io: IOException) {
        lastError = io
        if (index < attempts - 1) {
          try {
            Thread.sleep(retryDelayMs)
          } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            throw io
          }
        }
      }
    }

    throw lastError ?: IOException("Failed to fetch bundle")
  }

  private fun sanitizeToken(token: String?): String? {
    val trimmed = token?.trim()
    return if (trimmed.isNullOrEmpty()) null else trimmed
  }

  @Throws(IOException::class)
  private fun fetchOnce(requestUrl: HttpUrl): RuneDevBundle {
    val request = Request.Builder()
      .url(requestUrl)
      .header("Cache-Control", "no-cache")
      .build()

    client.newCall(request).execute().use { response ->
      if (!response.isSuccessful) {
        throw IOException("Unexpected response ${response.code}")
      }
      val body = response.body?.string()
        ?: throw IOException("Empty bundle response")
      return RuneDevBundle(code = body, url = requestUrl)
    }
  }
}
