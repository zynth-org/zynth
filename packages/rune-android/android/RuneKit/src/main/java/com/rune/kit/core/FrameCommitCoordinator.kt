package com.rune.kit.core

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewTreeObserver

private const val BLOCK_TIMEOUT_MS = 250L

/**
 * FrameCommitCoordinator coordinates a per-surface draw barrier that mirrors iOS's CATransaction-like
 * batching. While there are pending JS mutations, we install an OnPreDrawListener on the root view
 * and cancel frames until the native flush finishes with no residual work. This prevents the UI
 * from drawing half-styled nodes during the first few frames of a render.
 */
internal class FrameCommitCoordinator(
  private val rootView: RuneRootView,
  private val surfaceId: Int,
  private val logDebug: (String, String) -> Unit,
  private val tracer: VisualStateTracer?,
) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var pendingTransactions = 0
  private var isBlocking = false
  private var preDrawListener: ViewTreeObserver.OnPreDrawListener? = null
  private var registeredObserver: ViewTreeObserver? = null
  private var timeoutRunnable: Runnable? = null

  fun onMutationsQueued(reason: String? = null) {
    pendingTransactions++
    if (!isBlocking) {
      isBlocking = true
      logDebug("RuneFrame", "surface=$surfaceId blocking pre-draw${reason?.let { " ($it)" } ?: ""}")
      tracer?.trace("frame_block:start", reason ?: "pending mutations")
      attachPreDrawListener()
    }
    scheduleTimeout()
  }

  fun onFlushComplete(hasPendingWork: Boolean) {
    if (!isBlocking) return
    if (hasPendingWork) {
      scheduleTimeout()
      return
    }
    logDebug("RuneFrame", "surface=$surfaceId releasing block after $pendingTransactions tx")
    tracer?.trace("frame_block:release", "tx=$pendingTransactions")
    pendingTransactions = 0
    release()
  }

  fun cancel() {
    pendingTransactions = 0
    release()
  }

  private fun attachPreDrawListener() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      rootView.post { attachPreDrawListener() }
      return
    }
    val listener = preDrawListener ?: object : ViewTreeObserver.OnPreDrawListener {
      override fun onPreDraw(): Boolean {
        return if (isBlocking) {
          requestNextFrame()
          false
        } else {
          detachPreDrawListener()
          true
        }
      }
    }.also { preDrawListener = it }

    val observer = rootView.viewTreeObserver
    if (observer.isAlive) {
      if (registeredObserver !== observer) {
        registeredObserver?.let { prev ->
          if (prev.isAlive) {
            prev.removeOnPreDrawListener(listener)
          }
        }
        observer.addOnPreDrawListener(listener)
        registeredObserver = observer
      }
    }
    requestNextFrame()
  }

  private fun detachPreDrawListener() {
    val listener = preDrawListener ?: return
    registeredObserver?.let { observer ->
      if (observer.isAlive) {
        observer.removeOnPreDrawListener(listener)
      }
    }
    registeredObserver = null
  }

  private fun release() {
    if (!isBlocking) return
    isBlocking = false
    cancelTimeout()
    detachPreDrawListener()
    requestNextFrame()
  }

  private fun scheduleTimeout() {
    val runnable = Runnable {
      if (isBlocking) {
        Log.w("RuneFrame", "surface=$surfaceId commit barrier timed out, forcing release")
        tracer?.trace("frame_block:timeout", null)
        release()
      }
    }
    timeoutRunnable?.let { mainHandler.removeCallbacks(it) }
    timeoutRunnable = runnable
    mainHandler.postDelayed(runnable, BLOCK_TIMEOUT_MS)
  }

  private fun cancelTimeout() {
    timeoutRunnable?.let { mainHandler.removeCallbacks(it) }
    timeoutRunnable = null
  }

  private fun requestNextFrame() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
      rootView.postInvalidateOnAnimation()
    } else {
      rootView.invalidate()
    }
  }
}
