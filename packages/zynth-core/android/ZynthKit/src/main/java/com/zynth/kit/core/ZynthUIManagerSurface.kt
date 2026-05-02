package com.zynth.kit.core

import android.graphics.Rect
import android.util.Log
import android.view.View
import android.view.ViewGroup

private const val DEBUG_SURFACE = false

internal fun ZynthUIManager.markSurfaceDirty(surfaceId: Int, reason: String = "unknown") {
  runOnMain {
    ensureChoreographerInternal()
    if (!dirtySurfaces.add(surfaceId)) {
      return@runOnMain
    }
    needsLayout = true
    noteLayoutDebug("markSurfaceDirty:$reason")
    if (DEBUG_SURFACE) {
      Log.d("ZynthUI", "markSurfaceDirty surface=$surfaceId")
    }
    if (isBatching()) {
      markBatchNeedsLayout(reason)
      return@runOnMain
    }
    if (!frameCallbackPosted) {
      frameCallbackPosted = true
      choreographer?.postFrameCallback(frameCallback)
    }
  }
}

internal fun ZynthUIManager.markAllSurfacesDirty() {
  runOnMain {
    ensureChoreographerInternal()
    var added = 0
    for (surfaceId in surfaceRoots.keys) {
      val root = surfaceRoots[surfaceId]
      if (root != null) {
        syncSurfaceRootSize(surfaceId, root, root.width, root.height)
      }
      if (dirtySurfaces.add(surfaceId)) {
        added += 1
      }
    }
    if (added == 0) {
      return@runOnMain
    }
    needsLayout = true
    noteLayoutDebug("markAllSurfacesDirty")
    if (DEBUG_SURFACE) {
      Log.d("ZynthUI", "markAllSurfacesDirty count=${surfaceRoots.size}")
    }
    if (isBatching()) {
      markBatchNeedsLayout()
      return@runOnMain
    }
    if (!frameCallbackPosted) {
      frameCallbackPosted = true
      choreographer?.postFrameCallback(frameCallback)
    }
  }
}

internal fun ZynthUIManager.markSurfaceDirtyForNode(nodeId: Int, reason: String = "unknown") {
  val surfaceId = nodeSurfaces[nodeId] ?: activeSurfaceId
  markSurfaceDirty(surfaceId, "node:$reason")
}

internal fun ZynthUIManager.syncSurfaceRootSize(
  surfaceId: Int,
  root: ViewGroup,
  width: Int,
  height: Int
) {
  if (width <= 0 || height <= 0) return
  if (surfaceId != rootView.rootId) {
    val hasChildren = root.childCount > 0
    root.isClickable = hasChildren
    root.isFocusable = hasChildren
  }
  val prev = surfaceSizes[surfaceId]
  val next = width to height
  if (prev == null || prev.first != width || prev.second != height) {
    surfaceSizes[surfaceId] = next
    if (root !== rootView) {
      root.layout(0, 0, width, height)
      val wSpec = View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY)
      val hSpec = View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY)
      root.measure(wSpec, hSpec)
    }
    if (runtimePtr != 0L) {
      com.zynth.kit.runtime.JSBridge.updateSurfaceSize(
        runtimePtr,
        surfaceId,
        pxToDp(width.toFloat()).toFloat(),
        pxToDp(height.toFloat()).toFloat()
      )
    }
    dirtySurfaces.add(surfaceId)
  }
}

internal fun ZynthUIManager.registerSurfaceInternal(
  surfaceId: Int,
  root: ViewGroup,
  owned: Boolean
) {
  val beforeCount = surfaceRoots.size
  val existingRoot = surfaceRoots[surfaceId]
  if (existingRoot === root && surfaceRoots.containsKey(surfaceId)) {
    if (owned) {
      ownedSurfaces.add(surfaceId)
    } else {
      ownedSurfaces.remove(surfaceId)
    }
    return
  }
  surfaceRoots[surfaceId] = root
  surfaceFirstFrameListeners.remove(surfaceId)
  surfaceFirstFrameDispatched.remove(surfaceId)
  surfaceFirstFramePending.remove(surfaceId)
  if (owned) {
    ownedSurfaces.add(surfaceId)
  } else {
    ownedSurfaces.remove(surfaceId)
  }
  if (surfaceId != rootView.rootId) {
    if (root.layoutParams == null) {
      root.layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    }
    ZynthPointerEvents.set(root, ZynthPointerEvents.Mode.BOX_NONE)
  }
  surfaceLayoutListeners.remove(surfaceId)?.let { root.removeOnLayoutChangeListener(it) }
  val listener = View.OnLayoutChangeListener { v, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
    if (left != oldLeft || top != oldTop || right != oldRight || bottom != oldBottom) {
      syncSurfaceRootSize(surfaceId, v as ViewGroup, right - left, bottom - top)
    }
  }
  root.addOnLayoutChangeListener(listener)
  surfaceLayoutListeners[surfaceId] = listener

  syncSurfaceRootSize(surfaceId, root, root.width, root.height)
}

internal fun ZynthUIManager.unregisterSurfaceInternal(surfaceId: Int) {
  if (surfaceId == rootView.rootId) return
  val root = surfaceRoots[surfaceId] ?: return

  surfaceLayoutListeners.remove(surfaceId)?.let { root.removeOnLayoutChangeListener(it) }
  surfaceFirstFrameListeners.remove(surfaceId)
  surfaceFirstFrameDispatched.remove(surfaceId)
  surfaceFirstFramePending.remove(surfaceId)

  val nodeIds = nodeSurfaces.filterValues { it == surfaceId }.keys.toList()
  for (nodeId in nodeIds) {
    val view = nodes[nodeId]
    if (view != null) {
      runOnMain { (view.parent as? ViewGroup)?.removeView(view) }
    }
    destroyNode(nodeId)
    parents.remove(nodeId)
    nodes.remove(nodeId)
  }

  dirtySurfaces.remove(surfaceId)
  surfaceSizes.remove(surfaceId)
  surfaceRoots.remove(surfaceId)

  if (ownedSurfaces.remove(surfaceId)) {
    runOnMain { (root.parent as? ViewGroup)?.removeView(root) }
  }

  if (activeSurfaceId == surfaceId) {
    activeSurfaceId = rootView.rootId
  }
}

internal fun ZynthUIManager.addSurfaceFirstFrameListener(surfaceId: Int, listener: () -> Unit) {
  runOnMain {
    if (surfaceFirstFrameDispatched.contains(surfaceId)) {
      listener()
      return@runOnMain
    }
    val listeners = surfaceFirstFrameListeners.getOrPut(surfaceId) { mutableListOf() }
    listeners.add(listener)
  }
}

internal fun ZynthUIManager.removeSurfaceFirstFrameListener(surfaceId: Int, listener: () -> Unit) {
  runOnMain {
    val listeners = surfaceFirstFrameListeners[surfaceId] ?: return@runOnMain
    listeners.remove(listener)
    if (listeners.isEmpty()) {
      surfaceFirstFrameListeners.remove(surfaceId)
    }
  }
}

internal fun ZynthUIManager.dispatchSurfaceFirstFrameIfNeeded(surfaceId: Int) {
  val root = surfaceRoots[surfaceId] ?: rootView
  if (!root.isAttachedToWindow) return
  if (root.childCount == 0) return
  if (!root.hasVisibleContent()) return
  if (surfaceFirstFrameDispatched.contains(surfaceId)) return
  if (!surfaceFirstFramePending.add(surfaceId)) return
  val observer = root.viewTreeObserver
  if (!observer.isAlive) {
    surfaceFirstFramePending.remove(surfaceId)
    return
  }
  val listener = object : android.view.ViewTreeObserver.OnPreDrawListener {
    override fun onPreDraw(): Boolean {
      if (observer.isAlive) {
        observer.removeOnPreDrawListener(this)
      }
      surfaceFirstFramePending.remove(surfaceId)
      if (surfaceFirstFrameDispatched.contains(surfaceId)) return true
      if (!root.isAttachedToWindow || root.childCount == 0 || !root.hasVisibleContent()) return true
      surfaceFirstFrameDispatched.add(surfaceId)
      val callbacks = surfaceFirstFrameListeners.remove(surfaceId) ?: return true
      for (callback in callbacks) {
        runCatching { callback() }.onFailure {
          Log.w("ZynthUI", "Surface $surfaceId first-frame callback failed", it)
        }
      }
      return true
    }
  }
  observer.addOnPreDrawListener(listener)
}

private fun ViewGroup.hasVisibleContent(): Boolean {
  for (i in 0 until childCount) {
    val child = getChildAt(i)
    if (child.visibility != View.VISIBLE) continue
    if (child.width > 0 && child.height > 0) return true
  }
  return false
}

internal fun ZynthUIManager.ensureSurface(surfaceId: Int) {
  if (surfaceRoots.containsKey(surfaceId)) return
  val root = if (surfaceId == 0) {
    rootView
  } else {
    ZynthLayoutView(rootView.context).apply {
      layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    }.also { view ->
      runOnMain { rootView.addView(view) }
    }
  }
  registerSurfaceInternal(surfaceId, root, owned = surfaceId != rootView.rootId)
}

internal fun ZynthUIManager.rootViewForSurface(surfaceId: Int): ViewGroup {
  return surfaceRoots[surfaceId] ?: rootView
}
