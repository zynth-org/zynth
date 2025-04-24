package com.rune.kit.core

import android.view.Choreographer

class FrameScheduler {
    private val choreographer = Choreographer.getInstance()
    private var isFlushPending = false
    private var flushCallback: (() -> Unit)? = null
    val isIdle: Boolean
        get() = !isFlushPending
    
    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            isFlushPending = false
            flushCallback?.invoke()
        }
    }
    
    /**
     * Schedule a flush to happen on the next frame.
     * Multiple flush requests in the same frame are coalesced into one.
     */
    fun scheduleFlush(callback: () -> Unit) {
        flushCallback = callback
        
        if (!isFlushPending) {
            isFlushPending = true
            choreographer.postFrameCallback(frameCallback)
        }
    }
    
    /**
     * Cancel any pending flush operation
     */
    fun cancelFlush() {
        if (isFlushPending) {
            choreographer.removeFrameCallback(frameCallback)
            isFlushPending = false
        }
    }
    
    /**
     * Force immediate flush without waiting for frame callback
     */
    fun flushImmediate() {
        cancelFlush()
        flushCallback?.invoke()
    }
}
