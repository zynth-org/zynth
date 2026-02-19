package com.zynth.kit.core

import android.graphics.Rect
import android.util.Log
import android.view.View
import android.view.ViewGroup
import com.zynth.kit.layout.ZynthYogaLayout

private const val DEBUG_SURFACE = false

internal fun ZynthUIManager.markSurfaceDirty(surfaceId: Int) {
  runOnMain {
    ensureChoreographerInternal()
    if (!dirtySurfaces.add(surfaceId)) {
      return@runOnMain
    }
    needsLayout = true
    if (DEBUG_SURFACE) {
      Log.d("ZynthUI", "markSurfaceDirty surface=$surfaceId")
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

internal fun ZynthUIManager.markAllSurfacesDirty() {
  runOnMain {
    ensureChoreographerInternal()
    var added = 0
    for (surfaceId in surfaceRoots.keys) {
      if (dirtySurfaces.add(surfaceId)) {
        added += 1
      }
    }
    if (added == 0) {
      return@runOnMain
    }
    needsLayout = true
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

internal fun ZynthUIManager.markSurfaceDirtyForNode(nodeId: Int) {
  val surfaceId = nodeSurfaces[nodeId] ?: activeSurfaceId
  markSurfaceDirty(surfaceId)
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
    root.layout(0, 0, width, height)
    val wSpec = View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY)
    val hSpec = View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY)
    root.measure(wSpec, hSpec)
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
  if (existingRoot === root && surfaceYoga.containsKey(surfaceId)) {
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
  if (root !== rootView) {
    val listener = View.OnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
      if (left != oldLeft || top != oldTop || right != oldRight || bottom != oldBottom) {
        markSurfaceDirty(surfaceId)
      }
    }
    root.addOnLayoutChangeListener(listener)
    surfaceLayoutListeners[surfaceId] = listener
  }
  val layout = ZynthYogaLayout()
  layout.layoutDidUpdate = { nodeId, left, top, right, bottom, changed ->
    // Only secondary surfaces should use Kotlin layout to release first-mount visibility.
    // Root surface visibility is released by C++ applyLayoutResults to avoid one-frame drift.
    if (surfaceId != rootView.rootId && changed && pendingInitialLayoutNodes.remove(nodeId)) {
      nodes[nodeId]?.visibility = View.VISIBLE
    }
    if (changed && styleStates.containsKey(nodeId)) {
      styleLayoutDirtyNodes.add(nodeId)
      styleLayoutFrames[nodeId] = Rect(left, top, right, bottom)
    }
    if (changed) {
      if (layoutNodes.contains(nodeId)) {
        layoutDirtyNodes.add(nodeId)
      }
      maybeStartLayoutTransition(nodeId, left, top, right, bottom)
    }
  }
  surfaceYoga[surfaceId] = layout
  surfaceSizes[surfaceId] = (root.width to root.height)
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
    surfaceYoga[surfaceId]?.removeNode(nodeId)
  }

  dirtySurfaces.remove(surfaceId)
  cppLayoutAppliedSurfaces.remove(surfaceId)
  surfaceSizes.remove(surfaceId)
  surfaceYoga.remove(surfaceId)
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
  if (surfaceRoots.containsKey(surfaceId) && surfaceYoga.containsKey(surfaceId)) return
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

internal fun ZynthUIManager.yogaForSurface(surfaceId: Int): ZynthYogaLayout {
  return surfaceYoga[surfaceId] ?: run {
    ensureSurface(surfaceId)
    surfaceYoga[surfaceId] ?: surfaceYoga.getValue(0)
  }
}

internal fun ZynthUIManager.yogaForNode(nodeId: Int): ZynthYogaLayout {
  val surfaceId = nodeSurfaces[nodeId] ?: activeSurfaceId
  return yogaForSurface(surfaceId)
}
