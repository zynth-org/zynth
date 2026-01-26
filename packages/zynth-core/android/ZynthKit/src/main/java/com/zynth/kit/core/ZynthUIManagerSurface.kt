package com.zynth.kit.core

import android.graphics.Rect
import android.util.Log
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
  val prev = surfaceSizes[surfaceId]
  val next = width to height
  if (prev == null || prev.first != width || prev.second != height) {
    surfaceSizes[surfaceId] = next
    root.layout(0, 0, width, height)
    dirtySurfaces.add(surfaceId)
  }
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
  surfaceRoots[surfaceId] = root
  val layout = ZynthYogaLayout()
  layout.layoutDidUpdate = { nodeId, left, top, right, bottom, changed ->
    if (changed && styleStates.containsKey(nodeId)) {
      styleLayoutDirtyNodes.add(nodeId)
      styleLayoutFrames[nodeId] = Rect(left, top, right, bottom)
    }
  }
  surfaceYoga[surfaceId] = layout
  surfaceSizes[surfaceId] = (root.width to root.height)
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
