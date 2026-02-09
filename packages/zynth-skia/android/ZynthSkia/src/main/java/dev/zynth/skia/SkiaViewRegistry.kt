package dev.zynth.skia

import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap

object SkiaViewRegistry {
    private val views = ConcurrentHashMap<Int, WeakReference<ZynthSkiaView>>()

    fun register(nodeId: Int, view: ZynthSkiaView) {
        views[nodeId] = WeakReference(view)
    }

    fun unregister(nodeId: Int) {
        views.remove(nodeId)
    }

    fun get(nodeId: Int): ZynthSkiaView? {
        val ref = views[nodeId] ?: return null
        val view = ref.get()
        if (view == null) {
            views.remove(nodeId)
        }
        return view
    }

    fun clear() {
        views.clear()
    }
}
