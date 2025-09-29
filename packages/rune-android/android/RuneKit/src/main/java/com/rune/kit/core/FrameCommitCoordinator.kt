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
  private enum class BarrierMode { PREDRAW, HIDE_CONTENT, OFF }

  private val mode: BarrierMode = run {
    when (System.getProperty("rune.frameBarrier.mode")?.lowercase()) {
      "predraw", "pre_draw", "predraw_block" -> BarrierMode.PREDRAW
      "hide", "hide_content" -> BarrierMode.HIDE_CONTENT
      "off", "none", "disabled" -> BarrierMode.OFF
      else -> BarrierMode.HIDE_CONTENT
    }
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private var pendingTransactions = 0
  private var isBlocking = false
  private var preDrawListener: ViewTreeObserver.OnPreDrawListener? = null
  private var registeredObserver: ViewTreeObserver? = null
  private var timeoutRunnable: Runnable? = null
  private var previousContentVisibility: Int? = null

  fun onMutationsQueued(reason: String? = null) {
    if (mode == BarrierMode.OFF) return
    pendingTransactions++
    if (!isBlocking) {
      isBlocking = true
      logDebug("RuneFrame", "surface=$surfaceId commit barrier start${reason?.let { " ($it)" } ?: ""} mode=$mode")
      tracer?.trace("frame_block:start", reason ?: "pending mutations")
      when (mode) {
        BarrierMode.PREDRAW -> attachPreDrawListener()
        BarrierMode.HIDE_CONTENT -> setContentHidden(true)
        BarrierMode.OFF -> Unit
      }
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
    if (mode != BarrierMode.PREDRAW) return
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
    when (mode) {
      BarrierMode.PREDRAW -> detachPreDrawListener()
      BarrierMode.HIDE_CONTENT -> setContentHidden(false)
      BarrierMode.OFF -> Unit
    }
    requestNextFrame()
  }

  private fun setContentHidden(hidden: Boolean) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      rootView.post { setContentHidden(hidden) }
      return
    }
    if (hidden) {
      if (previousContentVisibility == null) {
        previousContentVisibility = rootView.contentView.visibility
      }
      if (rootView.contentView.visibility != android.view.View.INVISIBLE) {
        rootView.contentView.visibility = android.view.View.INVISIBLE
      }
      return
    }
    // Only restore visibility if the barrier itself is still holding the view in INVISIBLE.
    // If something else (e.g. first-frame reveal) has already changed it, don't override.
    if (rootView.contentView.visibility != android.view.View.INVISIBLE) {
      previousContentVisibility = null
      return
    }
    val restore = previousContentVisibility ?: android.view.View.VISIBLE
    previousContentVisibility = null
    if (rootView.contentView.visibility != restore) {
      rootView.contentView.visibility = restore
    }
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
