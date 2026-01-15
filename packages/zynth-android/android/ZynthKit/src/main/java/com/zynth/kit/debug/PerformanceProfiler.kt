package com.zynth.kit.debug

import java.util.concurrent.atomic.AtomicLong

object PerformanceProfiler {
    @Volatile
    var layoutStart: Long = 0
    @Volatile
    var layoutEnd: Long = 0
    @Volatile
    var renderStart: Long = 0
    @Volatile
    var renderEnd: Long = 0

    fun recordLayoutStart() {
        layoutStart = System.nanoTime()
    }

    fun recordLayoutEnd() {
        layoutEnd = System.nanoTime()
    }

    fun recordRenderStart() {
        renderStart = System.nanoTime()
    }

    fun recordRenderEnd() {
        renderEnd = System.nanoTime()
    }

    fun getFrameStats(): Map<String, Any> {
        val layoutTime = (layoutEnd - layoutStart) / 1_000_000.0
        val renderTime = (renderEnd - renderStart) / 1_000_000.0
        return mapOf(
            "layoutTime" to layoutTime,
            "renderTime" to renderTime
        )
    }
}
