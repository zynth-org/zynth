package com.zynth.kit.core

import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import com.zynth.kit.runtime.JSBridge
import kotlin.math.max

internal fun ZynthUIManager.pointerModeFor(id: Int): String {
  return pointerEvents[id] ?: "auto"
}

internal fun ZynthUIManager.updateInteractionState(id: Int) {
  val view = nodes[id] ?: return
  val mode = pointerModeFor(id)
  val hasPress = pressNodes.contains(id)
  val enableInteraction = mode != "none"
  val enablePress = hasPress && mode != "none" && mode != "box-none"
  runOnMain {
    view.isEnabled = enableInteraction
    view.isClickable = enablePress
    view.isLongClickable = enablePress
  }
}

internal fun ZynthUIManager.attachTouchListener(id: Int) {
  val view = nodes[id] ?: return
  if (touchListeners.containsKey(id)) return
  val listener = View.OnTouchListener { v, event ->
    handleTouchEvent(id, v, event)
  }
  touchListeners[id] = listener
  runOnMain { view.setOnTouchListener(listener) }
}

internal fun ZynthUIManager.handleTouchEvent(id: Int, view: View, event: MotionEvent): Boolean {
  val mode = pointerModeFor(id)
  if (mode == "none" || mode == "box-none") {
    return false
  }
  when (event.actionMasked) {
    MotionEvent.ACTION_DOWN -> {
      activePressNodes.add(id)
      longPressFired.remove(id)
      pressLocalPoints[id] = event.x to event.y
      pressScreenPoints[id] = event.rawX to event.rawY
      scheduleLongPress(id)
      val localX = pxToDp(event.x)
      val localY = pxToDp(event.y)
      val screenX = pxToDp(event.rawX)
      val screenY = pxToDp(event.rawY)
      runOnJS {
        JSBridge.invokePressEvent(
          runtimePtr,
          id,
          "onPressIn",
          localX,
          localY,
          screenX,
          screenY,
          -1.0,
          System.currentTimeMillis().toDouble(),
          false
        )
      }
      return true
    }
    MotionEvent.ACTION_MOVE -> {
      pressLocalPoints[id] = event.x to event.y
      pressScreenPoints[id] = event.rawX to event.rawY
      return true
    }
    MotionEvent.ACTION_UP -> {
      cancelLongPress(id)
      activePressNodes.remove(id)
      val inside = event.x >= 0 && event.y >= 0 &&
        event.x <= view.width && event.y <= view.height
      val longPressed = longPressFired.contains(id)
      if (inside && !longPressed) {
        val localX = pxToDp(event.x)
        val localY = pxToDp(event.y)
        val screenX = pxToDp(event.rawX)
        val screenY = pxToDp(event.rawY)
      runOnJS {
        JSBridge.invokePressEvent(
          runtimePtr,
          id,
          "onPress",
          localX,
            localY,
            screenX,
            screenY,
            -1.0,
            System.currentTimeMillis().toDouble(),
            false
          )
        }
        maybeDispatchDoublePress(id, event)
      }
      val outLocalX = pxToDp(event.x)
      val outLocalY = pxToDp(event.y)
      val outScreenX = pxToDp(event.rawX)
      val outScreenY = pxToDp(event.rawY)
      runOnJS {
        JSBridge.invokePressEvent(
          runtimePtr,
          id,
          "onPressOut",
          outLocalX,
          outLocalY,
          outScreenX,
          outScreenY,
          -1.0,
          System.currentTimeMillis().toDouble(),
          !inside
        )
      }
      return true
    }
    MotionEvent.ACTION_CANCEL -> {
      cancelLongPress(id)
      activePressNodes.remove(id)
      val localX = pxToDp(event.x)
      val localY = pxToDp(event.y)
      val screenX = pxToDp(event.rawX)
      val screenY = pxToDp(event.rawY)
      runOnJS {
        JSBridge.invokePressEvent(
          runtimePtr,
          id,
          "onPressOut",
          localX,
          localY,
          screenX,
          screenY,
          -1.0,
          System.currentTimeMillis().toDouble(),
          true
        )
      }
      return true
    }
  }
  return false
}

internal fun ZynthUIManager.longPressDurationFor(id: Int): Double {
  val duration = longPressDurations[id] ?: 500.0
  return max(0.0, duration)
}

internal fun ZynthUIManager.doublePressWindowFor(id: Int): Double {
  val window = doublePressWindows[id] ?: 250.0
  return max(0.0, window)
}

internal fun ZynthUIManager.scheduleLongPress(id: Int) {
  if (!longPressNodes.contains(id)) return
  cancelLongPress(id)
  val delayMs = longPressDurationFor(id)
  val runnable = Runnable {
    if (!activePressNodes.contains(id)) {
      cancelLongPress(id)
      return@Runnable
    }
    if (longPressFired.contains(id)) {
      cancelLongPress(id)
      return@Runnable
    }
    longPressFired.add(id)
    val local = pressLocalPoints[id] ?: (0f to 0f)
    val screen = pressScreenPoints[id] ?: (0f to 0f)
    runOnJS {
      JSBridge.invokePressEvent(
        runtimePtr,
        id,
        "onLongPress",
        pxToDp(local.first),
        pxToDp(local.second),
        pxToDp(screen.first),
        pxToDp(screen.second),
        delayMs,
        System.currentTimeMillis().toDouble(),
        false
      )
    }
    cancelLongPress(id)
  }
  longPressRunnables[id] = runnable
  mainHandler.postDelayed(runnable, delayMs.toLong())
}

internal fun ZynthUIManager.cancelLongPress(id: Int) {
  val runnable = longPressRunnables.remove(id)
  if (runnable != null) {
    mainHandler.removeCallbacks(runnable)
  }
}

internal fun ZynthUIManager.maybeDispatchDoublePress(id: Int, event: MotionEvent) {
  val timestamp = System.currentTimeMillis().toDouble()
  if (!doublePressNodes.contains(id)) {
    lastPressTimestamps[id] = timestamp
    return
  }
  val last = lastPressTimestamps[id]
  lastPressTimestamps[id] = timestamp
  if (last == null) return
  val delta = timestamp - last
  if (delta < 0 || delta > doublePressWindowFor(id)) return
    runOnJS {
      JSBridge.invokePressEvent(
        runtimePtr,
        id,
        "onDoublePress",
        pxToDp(event.x),
      pxToDp(event.y),
      pxToDp(event.rawX),
      pxToDp(event.rawY),
      -1.0,
      timestamp,
      false
    )
  }
}

internal fun ZynthUIManager.dispatchLayoutEvents() {
  if (layoutNodes.isEmpty()) return
  if (layoutPending.isEmpty() && layoutDirtyNodes.isEmpty()) return
  
  layoutEventBuffer.clear()
  val ids = LinkedHashSet<Int>()
  ids.addAll(layoutPending)
  ids.addAll(layoutDirtyNodes)
  layoutDirtyNodes.removeAll(ids)
  
  for (id in ids) {
    val view = nodes[id] ?: continue
    val frame = android.graphics.Rect(view.left, view.top, view.right, view.bottom)
    val previous = layoutFrames[id]
    val changed = previous == null ||
      previous.left != frame.left ||
      previous.top != frame.top ||
      previous.width() != frame.width() ||
      previous.height() != frame.height()
    val force = layoutPending.contains(id)
    if (!force && !changed) continue
    layoutFrames[id] = frame
    layoutPending.remove(id)
    layoutEventBuffer.add(
      ZynthUIManager.LayoutEvent(
        id,
        pxToDp(frame.left.toFloat()),
        pxToDp(frame.top.toFloat()),
        pxToDp(frame.width().toFloat()),
        pxToDp(frame.height().toFloat())
      )
    )
  }
  
  if (layoutEventBuffer.isNotEmpty()) {
    // Copy events to a new list to avoid ConcurrentModificationException
    // when runOnJS executes later and layoutEventBuffer is modified by the next frame.
    val eventsSnapshot = ArrayList(layoutEventBuffer)
    layoutEventBuffer.clear()
    runOnJS {
      val requiredSize = eventsSnapshot.size * 5
      if (layoutPayloadBuffer.size < requiredSize) {
        layoutPayloadBuffer = DoubleArray(requiredSize * 2)
      }
      var index = 0
      for (event in eventsSnapshot) {
        layoutPayloadBuffer[index++] = event.id.toDouble()
        layoutPayloadBuffer[index++] = event.x
        layoutPayloadBuffer[index++] = event.y
        layoutPayloadBuffer[index++] = event.width
        layoutPayloadBuffer[index++] = event.height
      }
      JSBridge.invokeLayoutEventsBatchSlice(runtimePtr, layoutPayloadBuffer, requiredSize)
    }
  }
}


internal fun ZynthUIManager.detachNode(id: Int) {
  val node = nodeStates[id]
  if (node != null) {
    node.layoutAnimator?.cancel()
    node.layoutAnimator = null
  }
  val runnable = longPressRunnables.remove(id)
  if (runnable != null) {
    mainHandler.removeCallbacks(runnable)
  }
}

internal fun ZynthUIManager.destroyNode(id: Int) {
  data class PendingDestroy(val nodeId: Int, val expanded: Boolean)

  val stack = ArrayDeque<PendingDestroy>()
  val queued = HashSet<Int>()
  stack.addLast(PendingDestroy(id, false))

  while (stack.isNotEmpty()) {
    val pending = stack.removeLast()
    val nodeId = pending.nodeId

    if (!pending.expanded) {
      if (!queued.add(nodeId)) {
        continue
      }
      
      if (!nodeStates.containsKey(nodeId)) {
        // If the node doesn't exist yet, it might be in the creation queue.
        // Mark it as dropped so createNode can skip it.
        droppedBeforeCreation.add(nodeId)
        continue
      }

      stack.addLast(PendingDestroy(nodeId, true))
      val childIds = children[nodeId]
      if (childIds != null) {
        for (index in childIds.size - 1 downTo 0) {
          stack.addLast(PendingDestroy(childIds[index], false))
        }
      }
      continue
    }

    try {
      val surfaceId = nodeSurfaces[nodeId]
      val layout = if (surfaceId != null) surfaceYoga[surfaceId] else null
      if (layout != null) {
        layout.removeNode(nodeId)
      } else {
        getLayoutEngine().removeNode(nodeId)
      }
    } catch (error: Throwable) {
      android.util.Log.e("ZynthUI", "Failed to remove node $nodeId from layout engine", error)
    }

    detachNode(nodeId)
    
    // Explicitly remove from parent ViewGroup to ensure no leaked View references in the UI tree.
    nodes[nodeId]?.let { view ->
      (view.parent as? android.view.ViewGroup)?.removeView(view)
    }

    val node = nodeStates.remove(nodeId)
    if (node != null) {
      runCatching {
        val descriptor = com.zynth.kit.components.ZynthComponentRegistry.getDescriptor(node.type)
        descriptor?.onReset?.invoke(node)
      }
      node.attachments.clear()
      node.textChildren.clear()
    }

    val parentId = parents.remove(nodeId)
    if (parentId != null) {
      val siblings = children[parentId]
      if (siblings != null) {
        siblings.remove(nodeId as Any?)
        if (siblings.isEmpty()) {
          children.remove(parentId)
        }
      }
      nodeStates[parentId]?.textChildren?.removeAll { it == nodeId }
    }

    nodeSurfaces.remove(nodeId)
    pointerEvents.remove(nodeId)
    pressNodes.remove(nodeId)
    longPressNodes.remove(nodeId)
    doublePressNodes.remove(nodeId)
    activePressNodes.remove(nodeId)
    longPressFired.remove(nodeId)
    longPressDurations.remove(nodeId)
    doublePressWindows.remove(nodeId)
    lastPressTimestamps.remove(nodeId)
    pressLocalPoints.remove(nodeId)
    pressScreenPoints.remove(nodeId)
    layoutNodes.remove(nodeId)
    layoutPending.remove(nodeId)
    layoutDirtyNodes.remove(nodeId)
    layoutFrames.remove(nodeId)
    layoutTransitionFrames.remove(nodeId)
    styleDirtyNodes.remove(nodeId)
    styleStates.remove(nodeId)
    styleLayoutDirtyNodes.remove(nodeId)
    styleLayoutFrames.remove(nodeId)
    textStyleStates.remove(nodeId)
    yogaStyleCache.remove(nodeId)
    children.remove(nodeId)

    val listener = touchListeners.remove(nodeId)
    val view = nodes.remove(nodeId)
    if (listener != null && view != null) {
      runOnMain { view.setOnTouchListener(null) }
    }
  }
}
