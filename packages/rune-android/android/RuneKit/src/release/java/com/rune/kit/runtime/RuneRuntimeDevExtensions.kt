package com.rune.kit.runtime

/**
 * Release build stubs for dev-only methods.
 * These are no-ops to ensure the code compiles in release mode.
 */

// Empty stubs - these methods should never be called in release builds
// No-op implementations for release builds
internal fun RuneRuntime.connectDevServerInternal(url: String) {
  // No-op in release
}

internal fun RuneRuntime.refreshDevBundleInternal() {
  // No-op in release
}

internal fun RuneRuntime.handleDevMessageInternal(payload: String) {
  // No-op in release
}

internal fun RuneRuntime.configureDevServer() {
  // No-op in release builds
}

internal fun RuneRuntime.installHmrShim() {
  // No-op in release builds
}

internal fun RuneRuntime.disconnectDevServer() {
  // No-op in release builds
}

internal fun RuneRuntime.loadDevBundleIfAvailable(): Boolean {
  return false
}

internal fun RuneRuntime.refreshDevBundle() {
  // No-op in release builds
}

internal fun RuneRuntime.connectDevServer(url: String) {
  // No-op in release builds
}

fun RuneRuntime.handleDevMessage(payload: String) {
  // No-op in release builds
}

internal fun RuneRuntime.installDevServerGlobal(url: String) {
  // No-op in release builds
}

internal fun RuneRuntime.restoreDevServerUrl() {
  // No-op in release builds
}
