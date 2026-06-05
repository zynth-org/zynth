package com.zynth.kit.core

import android.view.View
import android.view.ViewGroup

/**
 * Native-owned render target for embedding Zynth-rendered JSX inside platform
 * chrome without routing through a component-specific registration path.
 */
class ZynthPortalSurface internal constructor(
  val surfaceId: Int,
  val rootView: ZynthRootView,
  private val manager: ZynthUIManager,
) {
  fun resizePx(width: Int, height: Int) {
    if (width <= 0 || height <= 0) return
    rootView.measure(
      View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
    )
    rootView.layout(0, 0, width, height)
    manager.syncPortalSurfaceSize(surfaceId, rootView, width, height)
  }

  fun dispose() {
    manager.disposePortalSurface(surfaceId)
  }
}

fun ZynthUIManager.createPortalSurface(widthPx: Int, heightPx: Int): ZynthPortalSurface {
  val root = ZynthRootView(rootView.context).apply {
    isClickable = false
    isFocusable = false
    layoutParams = ViewGroup.LayoutParams(widthPx, heightPx)
  }
  registerPortalSurface(root.rootId, root, widthPx, heightPx)
  return ZynthPortalSurface(root.rootId, root, this)
}

internal fun ZynthUIManager.registerPortalSurface(
  surfaceId: Int,
  root: ZynthRootView,
  widthPx: Int,
  heightPx: Int,
) {
  registerSurfaceInternal(surfaceId, root, owned = true)
  syncPortalSurfaceSize(surfaceId, root, widthPx, heightPx)
}

internal fun ZynthUIManager.syncPortalSurfaceSize(
  surfaceId: Int,
  root: ViewGroup,
  widthPx: Int,
  heightPx: Int,
) {
  syncSurfaceRootSize(surfaceId, root, widthPx, heightPx)
  markSurfaceDirty(surfaceId, "portal-resize")
}

internal fun ZynthUIManager.disposePortalSurface(surfaceId: Int) {
  unregisterSurfaceInternal(surfaceId)
}
