package com.zynth.kit.runtime

/**
 * Release build stubs for dev-only methods.
 * These are no-ops to ensure the code compiles in release mode.
 */

// Empty stubs - these methods should never be called in release builds
// No-op implementations for release builds
internal fun ZynthRuntime.connectDevServerInternal(url: String, token: String?) {
  // No-op in release
}

internal fun ZynthRuntime.refreshDevBundleInternal() {
  // No-op in release
}

internal fun ZynthRuntime.handleDevMessageInternal(payload: String) {
  // No-op in release
}

internal fun ZynthRuntime.configureDevServer() {
  // No-op in release builds
}

internal fun ZynthRuntime.installHmrShim() {
  // No-op in release builds
}

internal fun ZynthRuntime.disconnectDevServer() {
  // No-op in release builds
}

internal fun ZynthRuntime.loadDevBundleIfAvailable(): Boolean {
  return false
}

internal fun ZynthRuntime.refreshDevBundle() {
  // No-op in release builds
}

internal fun ZynthRuntime.connectDevServer(url: String, token: String?) {
  // No-op in release builds
}

fun ZynthRuntime.handleDevMessage(payload: String) {
  // No-op in release builds
}

internal fun ZynthRuntime.installDevServerGlobal(url: String, token: String?) {
  // No-op in release builds
}

internal fun ZynthRuntime.restoreDevServerUrl() {
  // No-op in release builds
}

// Release-only stubs for dev-only properties referenced from main sources.
internal var ZynthRuntime.devServerUrl: String?
  get() = null
  set(value) {
    // No-op in release
  }

internal var ZynthRuntime.hasSuccessfulDevBundle: Boolean
  get() = false
  set(value) {
    // No-op in release
  }

internal var ZynthRuntime.lastDevBundle: ZynthDevBundle?
  get() = null
  set(value) {
    // No-op in release
  }

// Release stub for dev-only bundle type.
internal class ZynthDevBundle(
  val url: String = "",
  val code: String = "",
)
