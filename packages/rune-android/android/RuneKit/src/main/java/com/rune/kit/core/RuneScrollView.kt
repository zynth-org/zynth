package com.rune.kit.core

import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.util.Log
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import android.view.View.MeasureSpec
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import androidx.core.widget.NestedScrollView
import com.rune.kit.layout.Style
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import org.json.JSONArray
import org.json.JSONObject

private const val DEBUG_SCROLL_LOGS = false

internal class RuneScrollView(
  context: Context,
) : FrameLayout(context) {

  enum class Axis {
    VERTICAL,
    HORIZONTAL,
  }

  private val verticalHost = RuneVerticalScrollHost(context)
  private val horizontalHost = RuneHorizontalScrollHost(context)
  private val contentView = FrameLayout(context)
  private var host: ScrollHost = verticalHost

  private val choreographer by lazy(LazyThreadSafetyMode.NONE) { Choreographer.getInstance() }
  private var manager: RuneUIManager? = null
  private var nodeId: Int = -1
  private var axis: Axis = Axis.VERTICAL
  private var scrollEnabled: Boolean = true
  private var directionalLockEnabled: Boolean = true
  private var overScrollBehavior: String = "auto"
  private var eventThrottleMs: Long = 16L
  private var eventMinDisplacementPx: Float = 0f
  private var bridgeCoalescing: Boolean = true
  private var lastCommandSeq: Long = -1L

  private var isDragging = false
  private var isDecelerating = false

  private var declaredHeight: Int? = null
  private var declaredMinHeight: Int? = null
  private var declaredMaxHeight: Int? = null

  private var lastDispatchedX = 0
  private var lastDispatchedY = 0
  private var lastDispatchTime = 0L
  private var lastVelocityX = 0f
  private var lastVelocityY = 0f

  private var coalescedPayload: JSONObject? = null
  private var coalesceScheduled = false
  private var pendingMomentumEndCheck = false
  private var snapPendingCheck = false
  private var snapPendingForce = false

  private var snapEnabled = false
  private var snapAxisMode: String = "both"
  private var snapStrictness: String = "none"
  private var snapAlignments: List<String> = emptyList()
  private var snapStopAlways = false
  private var snapPaddingStart = 0
  private var snapPaddingEnd = 0
  private var snapPaddingTop = 0
  private var snapPaddingBottom = 0

  private val coalesceCallback = Choreographer.FrameCallback {
    coalesceScheduled = false
    coalescedPayload?.let { payload ->
      dispatchScrollEventInternal("onScroll", payload, force = true)
    }
    coalescedPayload = null
  }

  init {
    isClickable = false
    isFocusable = false
    clipChildren = false
    clipToPadding = false

    attachHost(verticalHost)
  }

  fun bind(manager: RuneUIManager, nodeId: Int) {
    this.manager = manager
    this.nodeId = nodeId
  }

  fun unbind() {
    manager = null
    nodeId = -1
  }

  fun applyStyle(style: Style) {
    declaredHeight = style.height?.roundToInt()
    declaredMinHeight = style.minHeight?.roundToInt()
    declaredMaxHeight = style.maxHeight?.roundToInt()
    invalidate()
    requestLayout()
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    var measuredWidth = measuredWidth
    var measuredHeight = measuredHeight
    declaredHeight?.let { measuredHeight = it }
    declaredMaxHeight?.let { measuredHeight = measuredHeight.coerceAtMost(it) }
    declaredMinHeight?.let { measuredHeight = measuredHeight.coerceAtLeast(it) }
    setMeasuredDimension(measuredWidth, measuredHeight)
    logState("onMeasure w=${MeasureSpec.toString(widthMeasureSpec)} h=${MeasureSpec.toString(heightMeasureSpec)}")
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    logState("onLayout changed=$changed frame=[$left,$top,$right,$bottom]")
    post { logState("postLayout") }
  }

  override fun addView(child: View?, index: Int, params: ViewGroup.LayoutParams?) {
    if (child == null) return
    if (child === verticalHost.view || child === horizontalHost.view) {
      super.addView(child, index, params)
      return
    }
    contentView.addView(child, index, params)
  }

  override fun removeView(view: View?) {
    if (view == null) return
    if (view === verticalHost.view || view === horizontalHost.view) {
      super.removeView(view)
      return
    }
    contentView.removeView(view)
  }

  override fun removeViewAt(index: Int) {
    if (index < 0 || index >= contentView.childCount) return
    contentView.removeViewAt(index)
  }

  fun setAxis(horizontal: Boolean) {
    val desired = if (horizontal) Axis.HORIZONTAL else Axis.VERTICAL
    if (desired == axis) return
    axis = desired
    val newHost = if (axis == Axis.HORIZONTAL) horizontalHost else verticalHost
    if (host === newHost) return
    detachHost(host)
    attachHost(newHost)
    host = newHost
    host.setDirectionalLockEnabled(directionalLockEnabled)
    host.setLockedAxis(null)
    updateScrollEnabled()
    applyIndicatorStyles()
    if (snapEnabled) {
      scheduleSnapCheck(force = snapStrictness == "mandatory")
    }
  }

  fun setScrollEnabled(enabled: Boolean?) {
    scrollEnabled = enabled ?: true
    updateScrollEnabled()
    logState("setScrollEnabled=$scrollEnabled")
  }

  fun setDirectionalLockEnabled(enabled: Boolean?) {
    directionalLockEnabled = enabled ?: true
    verticalHost.setDirectionalLockEnabled(directionalLockEnabled)
    horizontalHost.setDirectionalLockEnabled(directionalLockEnabled)
  }

  fun setOverScrollBehavior(value: String?) {
    overScrollBehavior = value ?: "auto"
    val mode = when (overScrollBehavior) {
      "always" -> View.OVER_SCROLL_ALWAYS
      "never" -> View.OVER_SCROLL_NEVER
      else -> View.OVER_SCROLL_IF_CONTENT_SCROLLS
    }
    verticalHost.view.overScrollMode = mode
    horizontalHost.view.overScrollMode = mode
  }

  fun setScrollSnapType(value: Any?) {
    if (value == null || value == JSONObject.NULL) {
      snapEnabled = false
      snapAxisMode = "both"
      snapStrictness = "none"
      snapPendingCheck = false
      snapPendingForce = false
      return
    }
    if (value is String) {
      val normalized = value.lowercase()
      if (normalized == "none") {
        snapEnabled = false
        snapStrictness = "none"
        snapAxisMode = "both"
        snapPendingCheck = false
        snapPendingForce = false
        return
      }
      snapEnabled = true
      snapAxisMode = when (normalized) {
        "x", "inline" -> "x"
        "y", "block" -> "y"
        "both" -> "both"
        else -> "both"
      }
      snapStrictness = if (normalized == "proximity") "proximity" else "mandatory"
      return
    }
    if (value is JSONObject) {
      snapAxisMode = value.optString("axis", "both").lowercase()
      snapStrictness = value.optString("strictness", "proximity").lowercase()
      snapEnabled = snapStrictness != "none"
      if (!snapEnabled) {
        snapPendingCheck = false
        snapPendingForce = false
      }
      return
    }
    snapEnabled = true
    snapStrictness = "mandatory"
    snapAxisMode = "both"
  }

  fun setScrollSnapAlign(value: Any?) {
    snapAlignments = when (value) {
      null, JSONObject.NULL -> emptyList()
      is String -> listOf(value.lowercase())
      is JSONArray -> {
        val list = mutableListOf<String>()
        for (i in 0 until value.length()) {
          val entry = value.optString(i, null)?.lowercase()
          if (!entry.isNullOrEmpty()) list.add(entry)
        }
        list
      }
      else -> emptyList()
    }
  }

  fun setScrollSnapStop(value: Any?) {
    snapStopAlways = when (value) {
      is String -> value.equals("always", ignoreCase = true)
      else -> false
    }
  }

  fun setScrollPadding(value: Any?) {
    if (value == null || value == JSONObject.NULL) {
      snapPaddingStart = 0
      snapPaddingEnd = 0
      snapPaddingTop = 0
      snapPaddingBottom = 0
      return
    }
    if (value is Number) {
      val padding = value.toDouble().roundToInt().coerceAtLeast(0)
      snapPaddingStart = padding
      snapPaddingEnd = padding
      snapPaddingTop = padding
      snapPaddingBottom = padding
      return
    }
    if (value is String) {
      val numeric = value.toDoubleOrNull()
      if (numeric != null) {
        val padding = numeric.roundToInt().coerceAtLeast(0)
        snapPaddingStart = padding
        snapPaddingEnd = padding
        snapPaddingTop = padding
        snapPaddingBottom = padding
        return
      }
    }
    if (value is JSONObject) {
      fun read(key: String): Int? =
        if (value.has(key) && !value.isNull(key)) {
          value.optDouble(key).roundToInt().coerceAtLeast(0)
        } else null
      snapPaddingTop = read("top") ?: 0
      snapPaddingEnd = read("right") ?: 0
      snapPaddingBottom = read("bottom") ?: 0
      snapPaddingStart = read("left") ?: 0
      return
    }
  }

  fun setShowsVerticalScrollIndicator(show: Boolean?) {
    verticalHost.view.isVerticalScrollBarEnabled = show ?: true
  }

  fun setShowsHorizontalScrollIndicator(show: Boolean?) {
    horizontalHost.view.isHorizontalScrollBarEnabled = show ?: true
  }

  fun setIndicatorStyle(style: String?) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val color = when (style) {
        "black" -> 0xFF000000.toInt()
        "white" -> 0xFFFFFFFF.toInt()
        else -> 0
      }
      if (color != 0) {
        verticalHost.view.verticalScrollbarThumbDrawable?.setTint(color)
        horizontalHost.view.horizontalScrollbarThumbDrawable?.setTint(color)
      }
    }
  }

  fun setEventThrottle(ms: Long?) {
    val safe = ms ?: 16L
    eventThrottleMs = safe.coerceAtLeast(0L)
  }

  fun setEventMinDisplacement(px: Float?) {
    eventMinDisplacementPx = (px ?: 0f).coerceAtLeast(0f)
  }

  fun setBridgeCoalescing(enabled: Boolean?) {
    bridgeCoalescing = enabled ?: true
  }

  fun scrollTo(x: Int?, y: Int?, animated: Boolean) {
    val targetX = x ?: currentScrollX()
    val targetY = y ?: currentScrollY()
    host.scrollToPosition(targetX, targetY, animated)
  }

  fun scrollBy(dx: Int?, dy: Int?, animated: Boolean) {
    val targetX = currentScrollX() + (dx ?: 0)
    val targetY = currentScrollY() + (dy ?: 0)
    host.scrollToPosition(targetX, targetY, animated)
  }

  fun stopScroll() {
    host.stopScroll()
  }

  fun flashIndicators() {
    host.flashIndicators()
  }

  fun lockAxis(axis: Axis?) {
    verticalHost.setLockedAxis(axis)
    horizontalHost.setLockedAxis(axis)
  }

  fun applyCommand(command: JSONObject) {
    val seq = command.optLong("seq", -1L)
    if (seq >= 0 && seq == lastCommandSeq) return
    if (seq >= 0) {
      lastCommandSeq = seq
    }
    when (command.optString("type")) {
      "scrollTo" -> {
        val animated = command.optBoolean("animated", true)
        val x = if (command.has("x") && !command.isNull("x")) {
          command.optDouble("x").roundToInt()
        } else {
          null
        }
        val y = if (command.has("y") && !command.isNull("y")) {
          command.optDouble("y").roundToInt()
        } else {
          null
        }
        scrollTo(x, y, animated)
      }
      "scrollBy" -> {
        val animated = command.optBoolean("animated", true)
        val dx = if (command.has("dx") && !command.isNull("dx")) {
          command.optDouble("dx").roundToInt()
        } else {
          null
        }
        val dy = if (command.has("dy") && !command.isNull("dy")) {
          command.optDouble("dy").roundToInt()
        } else {
          null
        }
        scrollBy(dx, dy, animated)
      }
      "stop" -> stopScroll()
      "flashIndicators" -> flashIndicators()
      "lockAxis" -> {
        val axisName = command.optString("axis", null)
        val axisValue = when (axisName) {
          "horizontal" -> Axis.HORIZONTAL
          "vertical" -> Axis.VERTICAL
          else -> null
        }
        lockAxis(axisValue)
      }
    }
  }

  fun getMetrics(): JSONObject {
    val offsetX = currentScrollX()
    val offsetY = currentScrollY()
    val contentWidth = contentView.width
    val contentHeight = contentView.height
    val viewportWidth = width.takeIf { it > 0 } ?: host.view.width
    val viewportHeight = height.takeIf { it > 0 } ?: host.view.height
    val payload = JSONObject()
    payload.put("contentOffset", JSONObject().apply {
      put("x", offsetX)
      put("y", offsetY)
    })
    payload.put("contentSize", JSONObject().apply {
      put("width", contentWidth)
      put("height", contentHeight)
    })
    payload.put("layoutMeasurement", JSONObject().apply {
      put("width", viewportWidth)
      put("height", viewportHeight)
    })
    payload.put("velocity", JSONObject().apply {
      put("x", lastVelocityX)
      put("y", lastVelocityY)
    })
    payload.put("zoomScale", 1.0)
    return payload
  }

  internal fun handleScrollChanged(x: Int, y: Int) {
    logState("handleScrollChanged(x=$x,y=$y)")
    val now = SystemClock.uptimeMillis()
    val dt = (now - lastDispatchTime).coerceAtLeast(1L)
    val vx = ((x - lastDispatchedX) / dt.toFloat()) * 1000f
    val vy = ((y - lastDispatchedY) / dt.toFloat()) * 1000f
    lastVelocityX = vx
    lastVelocityY = vy
    val payload = buildPayload(x, y)
    if (bridgeCoalescing) {
      coalescedPayload = payload
      if (!coalesceScheduled) {
        coalesceScheduled = true
        choreographer.postFrameCallback(coalesceCallback)
      }
    } else {
      dispatchScrollEventInternal("onScroll", payload)
    }
  }

  internal fun handleBeginDrag() {
    if (isDragging) return
    isDragging = true
    isDecelerating = false
    logState("handleBeginDrag")
    dispatchScrollEventInternal("onScrollBeginDrag", buildPayload(currentScrollX(), currentScrollY()), force = true)
  }

  internal fun handleEndDrag() {
    if (!isDragging) return
    isDragging = false
    logState("handleEndDrag")
    dispatchScrollEventInternal("onScrollEndDrag", buildPayload(currentScrollX(), currentScrollY()), force = true)
    scheduleMomentumEndCheck()
    scheduleSnapCheck(force = snapStrictness == "mandatory")
  }

  internal fun handleMomentumBegin() {
    if (isDecelerating) return
    isDecelerating = true
    logState("handleMomentumBegin")
    dispatchScrollEventInternal("onMomentumScrollBegin", buildPayload(currentScrollX(), currentScrollY()), force = true)
  }

  internal fun handleMomentumEnd() {
    if (!isDecelerating) return
    isDecelerating = false
    logState("handleMomentumEnd")
    dispatchScrollEventInternal("onMomentumScrollEnd", buildPayload(currentScrollX(), currentScrollY()), force = true)
    scheduleSnapCheck(force = true)
  }

  private fun scheduleMomentumEndCheck() {
    if (pendingMomentumEndCheck) return
    pendingMomentumEndCheck = true
    postDelayed({
      pendingMomentumEndCheck = false
      if (!isDragging && abs(lastVelocityX) < 5f && abs(lastVelocityY) < 5f) {
        handleMomentumEnd()
      }
    }, 120L)
  }

  private fun scheduleSnapCheck(force: Boolean = false) {
    if (!shouldSnap()) return
    snapPendingForce = snapPendingForce || force || snapStopAlways
    if (snapPendingCheck) return
    snapPendingCheck = true
    post {
      snapPendingCheck = false
      val forceSnap = snapPendingForce
      snapPendingForce = false
      snapToNearest(forceSnap)
    }
  }

  private fun shouldSnap(): Boolean {
    if (!snapEnabled) return false
    return when (snapAxisMode) {
      "x", "inline" -> axis == Axis.HORIZONTAL
      "y", "block" -> axis == Axis.VERTICAL
      "both" -> true
      else -> true
    }
  }

  private fun snapToNearest(force: Boolean) {
    if (!shouldSnap()) return
    if (contentView.childCount == 0) return
    val viewportWidth = host.view.width.takeIf { it > 0 } ?: width
    val viewportHeight = host.view.height.takeIf { it > 0 } ?: height

    val viewportSize = if (axis == Axis.HORIZONTAL) viewportWidth else viewportHeight
    if (viewportSize <= 0) return

    val currentOffset = if (axis == Axis.HORIZONTAL) currentScrollX() else currentScrollY()
    val maxScroll = if (axis == Axis.HORIZONTAL) {
      max(0, contentView.width - viewportWidth)
    } else {
      max(0, contentView.height - viewportHeight)
    }

    val candidates: List<View> = if (contentView.childCount == 1) {
      val sole = contentView.getChildAt(0)
      if (sole is ViewGroup && sole.childCount > 0) {
        val list = mutableListOf<View>()
        for (i in 0 until sole.childCount) {
          list.add(sole.getChildAt(i))
        }
        list
      } else {
        listOf(sole)
      }
    } else {
      val list = mutableListOf<View>()
      for (i in 0 until contentView.childCount) {
        list.add(contentView.getChildAt(i))
      }
      list
    }
    if (candidates.isEmpty()) return

    val alignments = if (snapAlignments.isEmpty()) listOf("start") else snapAlignments
    var bestTarget = -1
    var bestDistance = Float.MAX_VALUE

    for (child in candidates) {
      val childStart = if (axis == Axis.HORIZONTAL) child.left else child.top
      val childSize = if (axis == Axis.HORIZONTAL) child.width else child.height
      if (childSize <= 0) continue
      val childEnd = childStart + childSize
      for (align in alignments) {
        val target = when (align) {
          "center" -> (childStart + childSize / 2f) - viewportSize / 2f
          "end" -> {
            val paddingEnd = if (axis == Axis.HORIZONTAL) snapPaddingEnd else snapPaddingBottom
            (childEnd + paddingEnd - viewportSize).toFloat()
          }
          else -> {
            val paddingStart = if (axis == Axis.HORIZONTAL) snapPaddingStart else snapPaddingTop
            (childStart - paddingStart).toFloat()
          }
        }
        val clamped = target.roundToInt().coerceIn(0, maxScroll)
        val distance = abs(clamped - currentOffset).toFloat()
        if (distance < bestDistance - 0.5f) {
          bestDistance = distance
          bestTarget = clamped
        }
      }
    }

    if (bestTarget < 0) return

    val threshold = viewportSize * 0.25f
    val shouldSnapNow = force || snapStrictness == "mandatory" || bestDistance <= threshold
    if (!shouldSnapNow) return

    if (snapStopAlways) {
      host.stopScroll()
    }

    val targetX = if (axis == Axis.HORIZONTAL) bestTarget else currentScrollX()
    val targetY = if (axis == Axis.VERTICAL) bestTarget else currentScrollY()
    host.scrollToPosition(targetX, targetY, animated = true)
  }

  private fun buildPayload(x: Int, y: Int): JSONObject {
    val payload = JSONObject()
    payload.put("contentOffset", JSONObject().apply {
      put("x", x)
      put("y", y)
    })
    payload.put("contentSize", JSONObject().apply {
      put("width", contentView.width)
      put("height", contentView.height)
    })
    payload.put("layoutMeasurement", JSONObject().apply {
      put("width", host.view.width)
      put("height", host.view.height)
    })
    payload.put("velocity", JSONObject().apply {
      put("x", lastVelocityX)
      put("y", lastVelocityY)
    })
    payload.put("zoomScale", 1.0)
    return payload
  }

  private fun dispatchScrollEventInternal(
    event: String,
    payload: JSONObject,
    force: Boolean = false,
  ) {
    val now = SystemClock.uptimeMillis()
    if (!force) {
      val dt = now - lastDispatchTime
      if (event == "onScroll" && dt < eventThrottleMs) {
        return
      }
      val dx = abs(payload.optJSONObject("contentOffset")?.optInt("x") ?: 0 - lastDispatchedX)
      val dy = abs(payload.optJSONObject("contentOffset")?.optInt("y") ?: 0 - lastDispatchedY)
      if (event == "onScroll" && dx < eventMinDisplacementPx && dy < eventMinDisplacementPx) {
        return
      }
    }
    lastDispatchTime = now
    payload.optJSONObject("contentOffset")?.let {
      lastDispatchedX = it.optInt("x")
      lastDispatchedY = it.optInt("y")
    }
    manager?.dispatchEvent(nodeId, event, payload)
  }

  private fun attachHost(host: ScrollHost) {
    host.ensureContentAttached(contentView)
    if (host.view.parent !== this) {
      super.addView(
        host.view,
        LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT),
      )
    } else {
      host.view.bringToFront()
    }
  }

  private fun detachHost(host: ScrollHost) {
    if (host.view.parent === this) {
      super.removeView(host.view)
    }
  }

  private fun updateScrollEnabled() {
    host.setScrollEnabled(scrollEnabled)
  }

  private fun applyIndicatorStyles() {
    setShowsVerticalScrollIndicator(verticalHost.view.isVerticalScrollBarEnabled)
    setShowsHorizontalScrollIndicator(horizontalHost.view.isHorizontalScrollBarEnabled)
  }

  private fun currentScrollX(): Int {
    return host.view.scrollX
  }

  private fun currentScrollY(): Int {
    return host.view.scrollY
  }

  private fun logState(label: String) {
    if (!DEBUG_SCROLL_LOGS) return
    Log.d(
      "RuneScrollView",
      "[$label] node=$nodeId axis=$axis scrollY=${host.view.scrollY} hostH=${host.view.height} contentH=${contentView.height} children=${contentView.childCount} enabled=$scrollEnabled"
    )
  }

  private interface ScrollHost {
    val view: ViewGroup
    fun ensureContentAttached(content: View)
    fun setScrollEnabled(enabled: Boolean)
    fun setDirectionalLockEnabled(enabled: Boolean)
    fun setLockedAxis(axis: Axis?)
    fun scrollToPosition(x: Int, y: Int, animated: Boolean)
    fun stopScroll()
    fun flashIndicators()
  }

  private inner class RuneVerticalScrollHost(context: Context) :
    NestedScrollView(context),
    ScrollHost {
    private var lockedAxis: Axis? = null
    private var directionalLockEnabled = true
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    private var initialX = 0f
    private var initialY = 0f
    private var intercepting = false

    init {
      isFillViewport = false
      isVerticalScrollBarEnabled = true
      overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
      setOnTouchListener { _, event ->
        when (event.actionMasked) {
          MotionEvent.ACTION_DOWN -> {
            initialX = event.x
            initialY = event.y
            intercepting = false
            handleBeginDrag()
          }
          MotionEvent.ACTION_UP,
          MotionEvent.ACTION_CANCEL -> {
            handleEndDrag()
          }
        }
        false
      }
    }

    override fun onScrollChanged(l: Int, t: Int, oldl: Int, oldt: Int) {
      super.onScrollChanged(l, t, oldl, oldt)
      handleScrollChanged(l, t)
      if (!hasNestedScrollingParent()) {
        handleMomentumBegin()
      }
    }

    override fun onOverScrolled(scrollX: Int, scrollY: Int, clampedX: Boolean, clampedY: Boolean) {
      super.onOverScrolled(scrollX, scrollY, clampedX, clampedY)
      if (!clampedY) return
      handleMomentumEnd()
    }

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
      if (!isEnabled) return false
      if (!this@RuneScrollView.scrollEnabled) return false
      if (lockedAxis == Axis.HORIZONTAL) return false
      if (!directionalLockEnabled) return super.onInterceptTouchEvent(ev)
      when (ev.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          initialX = ev.x
          initialY = ev.y
          intercepting = false
        }
        MotionEvent.ACTION_MOVE -> {
          if (!intercepting) {
            val dx = abs(ev.x - initialX)
            val dy = abs(ev.y - initialY)
            if (dy > touchSlop && dy > dx) {
              intercepting = true
              return super.onInterceptTouchEvent(ev)
            }
            if (dx > touchSlop && dx > dy) {
              return false
            }
          }
        }
      }
      return super.onInterceptTouchEvent(ev)
    }

    override fun fling(velocityY: Int) {
      super.fling(velocityY)
      if (velocityY != 0) {
        handleMomentumBegin()
      }
    }

    override val view: ViewGroup
      get() = this

  override fun ensureContentAttached(content: View) {
      if (content.parent === this) return
      (content.parent as? ViewGroup)?.removeView(content)
      removeAllViews()
      addView(content, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
      Log.d("RuneScrollView", "ensureContentAttached vertical contentH=${content.height}")
    }

    override fun setScrollEnabled(enabled: Boolean) {
      isEnabled = enabled
    }

    override fun setDirectionalLockEnabled(enabled: Boolean) {
      directionalLockEnabled = enabled
    }

    override fun setLockedAxis(axis: Axis?) {
      lockedAxis = axis
    }

    override fun scrollToPosition(x: Int, y: Int, animated: Boolean) {
      val boundedY = max(0, min(y, getChildAt(0)?.height?.minus(height) ?: 0))
      if (animated) {
        smoothScrollTo(x, boundedY)
      } else {
        scrollTo(x, boundedY)
      }
    }

    override fun stopScroll() {
      stopNestedScroll()
      fling(0)
    }

    override fun flashIndicators() {
      awakenScrollBars()
    }
  }

  private inner class RuneHorizontalScrollHost(context: Context) :
    HorizontalScrollView(context),
    ScrollHost {

    private var lockedAxis: Axis? = null
    private var directionalLockEnabled = true
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    private var initialX = 0f
    private var initialY = 0f
    private var intercepting = false

    init {
      isHorizontalScrollBarEnabled = true
      overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
      isFillViewport = false
      setOnTouchListener { _, event ->
        when (event.actionMasked) {
          MotionEvent.ACTION_DOWN -> {
            initialX = event.x
            initialY = event.y
            intercepting = false
            handleBeginDrag()
          }
          MotionEvent.ACTION_UP,
          MotionEvent.ACTION_CANCEL -> {
            handleEndDrag()
          }
        }
        false
      }
    }

    override fun onScrollChanged(l: Int, t: Int, oldl: Int, oldt: Int) {
      super.onScrollChanged(l, t, oldl, oldt)
      handleScrollChanged(l, t)
      handleMomentumBegin()
    }

    override fun onOverScrolled(scrollX: Int, scrollY: Int, clampedX: Boolean, clampedY: Boolean) {
      super.onOverScrolled(scrollX, scrollY, clampedX, clampedY)
      if (!clampedX) return
      handleMomentumEnd()
    }

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
      if (!isEnabled) return false
      if (!this@RuneScrollView.scrollEnabled) return false
      if (lockedAxis == Axis.VERTICAL) return false
      if (!directionalLockEnabled) return super.onInterceptTouchEvent(ev)
      when (ev.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          initialX = ev.x
          initialY = ev.y
          intercepting = false
        }
        MotionEvent.ACTION_MOVE -> {
          if (!intercepting) {
            val dx = abs(ev.x - initialX)
            val dy = abs(ev.y - initialY)
            if (dx > touchSlop && dx > dy) {
              intercepting = true
              return super.onInterceptTouchEvent(ev)
            }
            if (dy > touchSlop && dy > dx) {
              return false
            }
          }
        }
      }
      return super.onInterceptTouchEvent(ev)
    }

    override fun fling(velocityX: Int) {
      super.fling(velocityX)
      if (velocityX != 0) {
        handleMomentumBegin()
      }
    }

    override val view: ViewGroup
      get() = this

    override fun ensureContentAttached(content: View) {
      if (content.parent === this) return
      (content.parent as? ViewGroup)?.removeView(content)
      removeAllViews()
      addView(content, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.MATCH_PARENT))
    }

    override fun setScrollEnabled(enabled: Boolean) {
      isEnabled = enabled
    }

    override fun setDirectionalLockEnabled(enabled: Boolean) {
      directionalLockEnabled = enabled
    }

    override fun setLockedAxis(axis: Axis?) {
      lockedAxis = axis
    }

    override fun scrollToPosition(x: Int, y: Int, animated: Boolean) {
      val boundedX = max(0, min(x, getChildAt(0)?.width?.minus(width) ?: 0))
      if (animated) {
        smoothScrollTo(boundedX, y)
      } else {
        scrollTo(boundedX, y)
      }
    }

    override fun stopScroll() {
      fling(0)
    }

    override fun flashIndicators() {
      awakenScrollBars()
    }
  }
}
