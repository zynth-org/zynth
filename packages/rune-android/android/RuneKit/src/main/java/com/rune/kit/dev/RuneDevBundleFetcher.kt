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
    val builder = base.newBuilder()
    val segments = base.pathSegments
    if (segments.isNotEmpty() && segments.last().isBlank()) {
      builder.removePathSegment(segments.size - 1)
    }
    return builder
      .addPathSegment("rune-native")
      .addPathSegment("bundle")
      .build()
  }

  @Throws(IOException::class)
  fun fetch(baseUrl: String): RuneDevBundle {
    val httpUrl = baseUrl.toHttpUrlOrNull()
      ?: throw IOException("Invalid dev server URL: $baseUrl")
    val requestUrl = buildBundleUrl(httpUrl)
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
