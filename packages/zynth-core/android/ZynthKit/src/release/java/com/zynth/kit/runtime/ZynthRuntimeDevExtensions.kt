package com.zynth.kit.runtime

internal fun ZynthRuntime.connectDevServerInternal(url: String, token: String? = null) {
  url.length
  token?.length
}

internal fun ZynthRuntime.handleDevMessageInternal(payload: String) {
  payload.length
}

internal fun ZynthRuntime.installHmrShim() {
  // no-op in release
}
