package com.zynth.kit.core

import android.os.Looper
import android.view.View
import android.widget.TextView
import com.zynth.kit.components.ZynthComponentRegistry
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

private const val SNAPSHOT_TIMEOUT_MS = 250L

internal fun ZynthUIManager.buildScreenSnapshot(options: JSONObject?): JSONObject {
  if (Looper.myLooper() == Looper.getMainLooper()) {
    return buildScreenSnapshotOnMain(options)
  }

  var snapshot: JSONObject? = null
  val latch = CountDownLatch(1)
  runOnMain {
    snapshot = buildScreenSnapshotOnMain(options)
    latch.countDown()
  }
  latch.await(SNAPSHOT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
  return snapshot ?: JSONObject().put("error", "snapshot_timeout")
}

private fun ZynthUIManager.buildScreenSnapshotOnMain(options: JSONObject?): JSONObject {
  val includeGlobalFrame = options?.optBoolean("includeGlobalFrame", true) ?: true
  val includeYogaStyles = options?.optBoolean("includeYogaStyles", true) ?: true
  val includeResolvedStyles = options?.optBoolean("includeResolvedStyles", false) ?: false
  val includeComponentState = options?.optBoolean("includeComponentState", false) ?: false
  val includeText = options?.optBoolean("includeText", false) ?: false
  val maxDepth = parseMaxDepth(options?.opt("maxDepth"))
  val rootNodeId = options?.opt("rootNodeId").toIntOrNull()
  val filterSurfaceId = options?.opt("surfaceId").toIntOrNull()

  val warnings = JSONArray()
  val surfaces = JSONArray()
  val surfaceIds = surfaceRoots.keys.sorted()
  val targetSurfaceIds = if (filterSurfaceId == null) {
    surfaceIds
  } else if (surfaceRoots.containsKey(filterSurfaceId)) {
    listOf(filterSurfaceId)
  } else {
    warnings.put("surface_not_found:$filterSurfaceId")
    emptyList()
  }

  val scopedRootNode = if (rootNodeId != null && !nodeStates.containsKey(rootNodeId)) {
    warnings.put("root_node_not_found:$rootNodeId")
    null
  } else {
    rootNodeId
  }

  for (surfaceId in targetSurfaceIds) {
    val rootView = surfaceRoots[surfaceId] ?: continue
    val surfaceNodeIds = nodeSurfaces
      .filterValues { it == surfaceId }
      .keys
      .toSet()
    if (surfaceNodeIds.isEmpty() && scopedRootNode == null) {
      surfaces.put(
        JSONObject()
          .put("surfaceId", surfaceId)
          .put("rootViewFrameGlobal", frameForView(rootView, includeGlobalFrame))
          .put("rootChildren", JSONArray())
          .put("nodes", JSONObject())
      )
      continue
    }

    val rootCandidates = parents
      .filterValues { it == 0 }
      .keys
      .filter { nodeSurfaces[it] == surfaceId }

    val includeIds = collectIncludedIds(
      surfaceId = surfaceId,
      surfaceNodeIds = surfaceNodeIds,
      rootNodeId = scopedRootNode,
      rootCandidates = rootCandidates,
      maxDepth = maxDepth
    )

    if (scopedRootNode != null && includeIds.isEmpty()) {
      continue
    }

    val nodesObject = JSONObject()
    for (nodeId in includeIds.sorted()) {
      val nodeState = nodeStates[nodeId] ?: continue
      val view = nodes[nodeId] ?: continue
      val nodeJson = JSONObject()
        .put("id", nodeId)
        .put("type", nodeState.type)
        .put("surfaceId", nodeSurfaces[nodeId] ?: surfaceId)
        .put("parentId", parents[nodeId] ?: JSONObject.NULL)
        .put("childIds", JSONArray(children[nodeId] ?: emptyList<Int>()))
        .put("viewClass", view.javaClass.simpleName)
        .put("frameLocal", localFrameForView(view))
        .put("visibility", visibilityForView(view))
        .put("alpha", view.alpha.toDouble())

      if (includeGlobalFrame) {
        nodeJson.put("frameGlobal", globalFrameForView(view))
      }
      if (includeYogaStyles) {
        nodeJson.put("yogaStyles", jsonFromMap(yogaStyleCache[nodeId]))
      }
      if (includeResolvedStyles) {
        nodeJson.put("resolvedStyles", resolvedStylesForNode(nodeId, view))
      }
      if (includeComponentState) {
        val componentState = ZynthComponentRegistry
          .getDescriptor(nodeState.type)
          ?.inspectState
          ?.invoke(this, nodeState)
        if (componentState != null) {
          nodeJson.put("componentState", jsonFromMap(componentState))
        }
      }
      if (includeText && view is TextView) {
        nodeJson.put("text", view.text?.toString() ?: "")
      }
      nodesObject.put(nodeId.toString(), nodeJson)
    }

    val rootChildren = JSONArray()
    if (scopedRootNode != null) {
      rootChildren.put(scopedRootNode)
    } else {
      for (rootId in rootCandidates.sorted()) {
        if (includeIds.contains(rootId)) {
          rootChildren.put(rootId)
        }
      }
    }

    surfaces.put(
      JSONObject()
        .put("surfaceId", surfaceId)
        .put("rootViewFrameGlobal", frameForView(rootView, includeGlobalFrame))
        .put("rootChildren", rootChildren)
        .put("nodes", nodesObject)
    )
  }

  return JSONObject()
    .put("version", 1)
    .put("platform", "android")
    .put("timestampMs", System.currentTimeMillis())
    .put("density", density.toDouble())
    .put("surfaces", surfaces)
    .put("warnings", warnings)
}

private fun ZynthUIManager.collectIncludedIds(
  surfaceId: Int,
  surfaceNodeIds: Set<Int>,
  rootNodeId: Int?,
  rootCandidates: List<Int>,
  maxDepth: Int
): Set<Int> {
  val includeIds = linkedSetOf<Int>()
  val queue = ArrayDeque<Pair<Int, Int>>()
  if (rootNodeId != null) {
    if (nodeSurfaces[rootNodeId] == surfaceId) {
      queue.add(rootNodeId to 0)
    }
  } else {
    for (rootId in rootCandidates) {
      queue.add(rootId to 0)
    }
  }

  while (queue.isNotEmpty()) {
    val (nodeId, depth) = queue.removeFirst()
    if (!surfaceNodeIds.contains(nodeId)) continue
    if (!includeIds.add(nodeId)) continue
    if (depth >= maxDepth) continue
    val childIds = children[nodeId] ?: emptyList()
    for (childId in childIds) {
      queue.add(childId to (depth + 1))
    }
  }
  return includeIds
}

private fun frameForView(view: View, includeGlobalFrame: Boolean): JSONObject {
  return if (includeGlobalFrame) globalFrameForView(view) else localFrameForView(view)
}

private fun localFrameForView(view: View): JSONObject {
  return JSONObject()
    .put("x", view.left)
    .put("y", view.top)
    .put("width", view.width)
    .put("height", view.height)
}

private fun globalFrameForView(view: View): JSONObject {
  val location = IntArray(2)
  runCatching { view.getLocationInWindow(location) }
  return JSONObject()
    .put("x", location[0])
    .put("y", location[1])
    .put("width", view.width)
    .put("height", view.height)
}

private fun visibilityForView(view: View): String {
  return when (view.visibility) {
    View.VISIBLE -> "visible"
    View.INVISIBLE -> "invisible"
    else -> "gone/hidden"
  }
}

private fun jsonFromMap(map: Map<String, Any?>?): JSONObject {
  val output = JSONObject()
  if (map == null) return output
  for ((key, value) in map) {
    output.put(key, value ?: JSONObject.NULL)
  }
  return output
}

private fun parseMaxDepth(value: Any?): Int {
  val parsed = value.toIntOrNull()
  if (parsed == null || parsed < 0) return Int.MAX_VALUE
  return parsed
}

private fun Any?.toIntOrNull(): Int? {
  return when (this) {
    is Int -> this
    is Long -> toInt()
    is Double -> toInt()
    is Float -> toInt()
    is String -> toIntOrNull()
    else -> null
  }
}

private fun ZynthUIManager.resolvedStylesForNode(nodeId: Int, view: View): JSONObject {
  val output = JSONObject()
    .put("opacity", view.alpha.toDouble())
    .put("elevation", view.elevation.toDouble())
    .put("zIndex", view.z.toDouble())
    .put("rotation", view.rotation.toDouble())
    .put("rotationX", view.rotationX.toDouble())
    .put("rotationY", view.rotationY.toDouble())
    .put("scaleX", view.scaleX.toDouble())
    .put("scaleY", view.scaleY.toDouble())
    .put("translationX", view.translationX.toDouble())
    .put("translationY", view.translationY.toDouble())
    .put("clipToOutline", view.clipToOutline)
    .put("pointerEvents", nodeStates[nodeId]?.pointerEvents ?: "auto")

  val state = styleStates[nodeId]
  if (state != null) {
    output
      .put("hasBorderDrawable", state.borderDrawable != null)
      .put("hasShadowLayers", state.shadowLayers != null)
      .put("shadowColor", state.shadowColor ?: JSONObject.NULL)
      .put("shadowOpacity", state.shadowOpacity ?: JSONObject.NULL)
      .put("shadowRadius", state.shadowRadius ?: JSONObject.NULL)
      .put("shadowOffsetX", state.shadowOffsetX ?: JSONObject.NULL)
      .put("shadowOffsetY", state.shadowOffsetY ?: JSONObject.NULL)
      .put("hasTransformOps", state.transformOps != null)
      .put("hasTransformOrigin", state.transformOrigin != null)
  }

  val textState = textStyleStates[nodeId]
  if (textState != null) {
    output
      .put("lineHeight", textState.lineHeight ?: JSONObject.NULL)
      .put("lineSpacing", textState.lineSpacing ?: JSONObject.NULL)
      .put("paragraphSpacing", textState.paragraphSpacing ?: JSONObject.NULL)
      .put("baselineShift", textState.baselineShift ?: JSONObject.NULL)
      .put("letterSpacing", textState.letterSpacing ?: JSONObject.NULL)
      .put("minimumFontScale", textState.minimumFontScale ?: JSONObject.NULL)
      .put("textDecorationLine", textState.textDecorationLine ?: JSONObject.NULL)
      .put("textTransform", textState.textTransform ?: JSONObject.NULL)
      .put("hyphenation", textState.hyphenation ?: JSONObject.NULL)
  }

  return output
}
