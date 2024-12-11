package com.rune.kit.dev

import java.io.IOException
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

data class RuneDevBundle(
  val code: String,
  val url: HttpUrl,
)

object RuneDevBundleFetcher {
  private val client: OkHttpClient = OkHttpClient.Builder()
    .retryOnConnectionFailure(true)
    .build()

  private fun buildBundleUrl(base: HttpUrl): HttpUrl {
    return base.newBuilder()
      .encodedPath("/main.js")
      .build()
  }

  @Throws(IOException::class)
  fun fetch(baseUrl: String, attempts: Int = 8, retryDelayMs: Long = 750): RuneDevBundle {
    val httpUrl = baseUrl.toHttpUrlOrNull()
      ?: throw IOException("Invalid dev server URL: $baseUrl")
    val requestUrl = buildBundleUrl(httpUrl)
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
