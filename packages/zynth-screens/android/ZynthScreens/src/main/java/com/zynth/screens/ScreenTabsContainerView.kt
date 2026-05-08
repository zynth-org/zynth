package com.zynth.screens

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.bottomnavigation.BottomNavigationItemView
import com.google.android.material.bottomnavigation.BottomNavigationMenuView
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.google.android.material.navigation.NavigationBarView
import com.zynth.kit.core.ZynthColorParser
import com.zynth.kit.core.ZynthPortalSurface
import com.zynth.kit.core.ZynthUIManager
import com.zynth.kit.core.createPortalSurface
import org.json.JSONArray
import org.json.JSONObject

@SuppressLint("ViewConstructor")
class ScreenTabsContainerView(context: Context) : FrameLayout(context) {

  companion object {
    private const val SURFACE_ICON_SIZE_DP = 24f
    private const val ICON_POSITION_FRAMES = 4
  }

  private data class SurfaceIconSlot(
    val routeKey: String,
    val index: Int,
    val portal: ZynthPortalSurface,
    val wrapper: FrameLayout,
  )

  private var uiManager: ZynthUIManager? = null
  private var nodeId: Int = -1
  private val contentContainer: FrameLayout
  private val bottomNav: BottomNavigationView
  private val iconOverlay: FrameLayout

  private var selectedIndex: Int = 0
  private var visibleIndex: Int = 0
  private var pendingIndex: Int? = null
  private var pendingStartMs: Long = 0L
  private var pendingPreDraw: ViewTreeObserver.OnPreDrawListener? = null
  private var tabAnimation: ScreenAnimation = ScreenAnimation.NONE
  private var nativeTabBarEnabled: Boolean = false
  private var tabBarVisible: Boolean = true
  private var lastTabBarItemsJson: String? = null
  private val pendingInsertIndices = HashMap<View, Int>()
  private val renderedIndices = HashSet<Int>()
  private val surfaceIcons = mutableMapOf<String, SurfaceIconSlot>()
  private val minHoldMs = 200L
  private val switchTimeoutMs = 700L
  private val baseBottomNavPaddingBottom: Int

  init {
    clipChildren = false
    clipToPadding = false

    contentContainer = object : FrameLayout(context) {
      override fun addView(child: View?, index: Int, params: ViewGroup.LayoutParams?) {
        super.addView(child, index, params)
        updateTabVisibility()
      }

      override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        for (i in 0 until childCount) {
          val child = getChildAt(i)
          child.layout(child.left, child.top, child.right, child.bottom)
        }
      }
    }

    bottomNav = BottomNavigationView(context).apply {
      clipChildren = false
      clipToPadding = false
      labelVisibilityMode = NavigationBarView.LABEL_VISIBILITY_LABELED
      isItemActiveIndicatorEnabled = true
      itemActiveIndicatorWidth = dpToPx(64f)
      itemActiveIndicatorHeight = dpToPx(32f)
      setOnItemSelectedListener { item ->
        val index = item.itemId
        if (index != selectedIndex && uiManager != null && nodeId != -1) {
          val event = JSONObject()
          event.put("index", index)
          uiManager?.dispatchEvent(nodeId, "onNativeTabSelect", event)
        }
        true
      }
      visibility = View.GONE
    }

    iconOverlay = FrameLayout(context).apply {
      clipChildren = false
      clipToPadding = false
      isClickable = false
      isFocusable = false
      visibility = View.GONE
      elevation = dpToPx(16f).toFloat()
      translationZ = dpToPx(16f).toFloat()
    }

    super.addView(
      contentContainer,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT),
    )
    super.addView(
      bottomNav,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.BOTTOM),
    )
    super.addView(
      iconOverlay,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.BOTTOM),
    )

    baseBottomNavPaddingBottom = bottomNav.paddingBottom
  }

  override fun addView(child: View?, index: Int, params: ViewGroup.LayoutParams?) {
    if (child === contentContainer || child === bottomNav || child === iconOverlay) {
      super.addView(child, index, params)
      return
    }
    val desiredIndex = child?.let { pendingInsertIndices.remove(it) } ?: index
    contentContainer.addView(child, desiredIndex, params)
  }

  override fun removeView(child: View?) {
    if (child === contentContainer || child === bottomNav || child === iconOverlay) {
      super.removeView(child)
      return
    }
    contentContainer.removeView(child)
  }

  fun trackInsertIndex(child: View, index: Int) {
    pendingInsertIndices[child] = index
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val measuredWidth = MeasureSpec.getSize(widthMeasureSpec)
    val measuredHeight = MeasureSpec.getSize(heightMeasureSpec)
    val shouldShow = shouldShowNativeTabBar()
    val tabBarHeight = measureTabBar(measuredWidth, measuredHeight, shouldShow)
    val contentHeight = (measuredHeight - tabBarHeight).coerceAtLeast(0)
    val widthSpec = MeasureSpec.makeMeasureSpec(measuredWidth, MeasureSpec.EXACTLY)

    contentContainer.measure(
      widthSpec,
      MeasureSpec.makeMeasureSpec(contentHeight, MeasureSpec.EXACTLY),
    )
    iconOverlay.measure(
      widthSpec,
      MeasureSpec.makeMeasureSpec(tabBarHeight, MeasureSpec.EXACTLY),
    )
    setMeasuredDimension(measuredWidth, measuredHeight)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val width = right - left
    val height = bottom - top
    if (width <= 0 || height <= 0) return

    val shouldShow = shouldShowNativeTabBar()
    val tabBarHeight = measureTabBar(width, height, shouldShow)
    val contentBottom = height - tabBarHeight

    contentContainer.layout(0, 0, width, contentBottom)
    if (shouldShow) {
      bottomNav.layout(0, contentBottom, width, height)
      iconOverlay.layout(0, contentBottom, width, height)
      iconOverlay.bringToFront()
    } else {
      bottomNav.layout(0, height, width, height)
      iconOverlay.layout(0, height, width, height)
    }
    scheduleIconPositions()
  }

  fun setUIManager(manager: ZynthUIManager) {
    uiManager = manager
  }

  fun setNodeId(id: Int) {
    nodeId = id
  }

  fun setSelectedIndex(index: Int) {
    if (selectedIndex == index) return
    selectedIndex = index
    if (nativeTabBarEnabled && bottomNav.menu.size() > index) {
      bottomNav.menu.getItem(index).isChecked = true
    }
    startDeferredSwitch(index)
    notifySurfaceIcons()
    scheduleIconPositions()
  }

  fun setTabAnimationType(type: String?) {
    tabAnimation = ScreenAnimation.fromString(type)
  }

  fun setNativeTabBarEnabled(enabled: Boolean) {
    nativeTabBarEnabled = enabled
    updateTabBarVisibility()
  }

  fun setTabBarOptions(json: String) {
    try {
      val options = JSONObject(json)
      val activeColor = parseColor(options.optString("activeTintColor"))
      val inactiveColor = parseColor(options.optString("inactiveTintColor"))
      val backgroundColor = parseColor(options.optString("backgroundColor"))
      val activeIndicatorColor = parseColor(options.optString("activeIndicatorColor"))
      tabBarVisible = options.optBoolean("visible", true)

      if (backgroundColor != null) {
        bottomNav.setBackgroundColor(backgroundColor)
        bottomNav.backgroundTintList = ColorStateList.valueOf(backgroundColor)
      }
      if (activeIndicatorColor != null) {
        bottomNav.itemActiveIndicatorColor = ColorStateList.valueOf(activeIndicatorColor)
      } else {
        bottomNav.itemActiveIndicatorColor = ColorStateList.valueOf(Color.parseColor("#E8DEF8"))
      }
      if (activeColor != null || inactiveColor != null) {
        val active = activeColor ?: Color.BLUE
        val inactive = inactiveColor ?: Color.GRAY
        val colorStateList = createColorStateList(active, inactive)
        bottomNav.itemIconTintList = colorStateList
        bottomNav.itemTextColor = colorStateList
      }

      val showLabels = options.optBoolean("showLabels", true)
      bottomNav.labelVisibilityMode = if (showLabels) {
        NavigationBarView.LABEL_VISIBILITY_LABELED
      } else {
        NavigationBarView.LABEL_VISIBILITY_UNLABELED
      }
    } catch (_: Exception) {
      return
    }

    updateTabBarVisibility()
  }

  fun setTabBarItems(json: String) {
    if (json == lastTabBarItemsJson) return
    lastTabBarItemsJson = json

    try {
      val items = JSONArray(json)
      unmountSurfaceIcons()
      bottomNav.menu.clear()
      val pendingSurfaceIcons = mutableListOf<Pair<Int, String>>()
      val iconSizePx = dpToPx(SURFACE_ICON_SIZE_DP)
      bottomNav.itemIconSize = iconSizePx

      for (i in 0 until items.length()) {
        val item = items.getJSONObject(i)
        val routeKey = item.getString("key")
        val label = item.optString("label", routeKey)
        val menuItem = bottomNav.menu.add(0, i, i, label)

        applyBadge(i, item)

        val icon = item.optJSONObject("icon")
        if (icon != null) {
          val type = icon.optString("type")
          if (type == "surface") {
            menuItem.icon = GradientDrawable().apply {
              setColor(Color.TRANSPARENT)
              setSize(iconSizePx, iconSizePx)
            }
            pendingSurfaceIcons.add(i to routeKey)
          } else if (type == "descriptor") {
            menuItem.setIcon(android.R.drawable.ic_menu_help)
          }
        }
      }

      if (bottomNav.menu.size() > selectedIndex) {
        bottomNav.menu.getItem(selectedIndex).isChecked = true
      }

      if (pendingSurfaceIcons.isNotEmpty()) {
        bottomNav.post {
          pendingSurfaceIcons.forEach { (index, routeKey) ->
            mountSurfaceIcon(index, routeKey)
          }
          scheduleIconPositions()
        }
      }
    } catch (_: Exception) {
      return
    }
  }

  private fun applyBadge(index: Int, item: JSONObject) {
    if (!item.has("badge")) {
      bottomNav.removeBadge(index)
      return
    }

    val badge = bottomNav.getOrCreateBadge(index)
    val badgeValue = item.getString("badge")
    badge.isVisible = true
    runCatching {
      badge.number = badgeValue.toInt()
    }
    if (item.has("badgeColor")) {
      val badgeColor = parseColor(item.getString("badgeColor"))
      if (badgeColor != null) badge.backgroundColor = badgeColor
    }
  }

  private fun mountSurfaceIcon(index: Int, routeKey: String) {
    val manager = uiManager ?: return
    if (surfaceIcons.containsKey(routeKey)) return

    val iconSizePx = dpToPx(SURFACE_ICON_SIZE_DP)
    val portal = manager.createPortalSurface(iconSizePx, iconSizePx)
    val wrapper = FrameLayout(context).apply {
      clipChildren = false
      clipToPadding = false
      isClickable = false
      isFocusable = false
      elevation = dpToPx(16f).toFloat()
      translationZ = dpToPx(16f).toFloat()
      addView(portal.rootView, LayoutParams(iconSizePx, iconSizePx))
    }

    iconOverlay.addView(wrapper, LayoutParams(iconSizePx, iconSizePx))
    val slot = SurfaceIconSlot(routeKey, index, portal, wrapper)
    surfaceIcons[routeKey] = slot
    hideMaterialIcon(index)
    positionSurfaceIcon(slot)
    dispatchSurfaceIconEvent("onNativeTabMount", slot)

    wrapper.post {
      positionSurfaceIcon(slot)
      dispatchSurfaceIconEvent("onNativeTabUpdate", slot)
    }
    wrapper.postOnAnimation {
      positionSurfaceIcon(slot)
      dispatchSurfaceIconEvent("onNativeTabUpdate", slot)
    }
  }

  private fun unmountSurfaceIcons() {
    surfaceIcons.values.forEach { slot ->
      iconOverlay.removeView(slot.wrapper)
      slot.portal.dispose()
    }
    surfaceIcons.clear()
  }

  private fun hideMaterialIcon(index: Int) {
    val itemView = itemViewAt(index) ?: return
    val iconView = findIconView(itemView) ?: return
    iconView.visibility = View.VISIBLE
    iconView.alpha = 0f
  }

  @SuppressLint("RestrictedApi")
  private fun itemViewAt(index: Int): BottomNavigationItemView? {
    val menuView = bottomNav.getChildAt(0) as? BottomNavigationMenuView ?: return null
    if (index < 0 || index >= menuView.childCount) return null
    return menuView.getChildAt(index) as? BottomNavigationItemView
  }

  private fun findIconView(group: ViewGroup): ImageView? {
    for (i in 0 until group.childCount) {
      val child = group.getChildAt(i)
      if (child is ImageView) return child
      if (child is ViewGroup) {
        val found = findIconView(child)
        if (found != null) return found
      }
    }
    return null
  }

  private fun scheduleIconPositions(frames: Int = ICON_POSITION_FRAMES) {
    positionSurfaceIcons()
    if (frames <= 0) return
    iconOverlay.postOnAnimation {
      positionSurfaceIcons()
      scheduleIconPositions(frames - 1)
    }
  }

  private fun positionSurfaceIcons() {
    surfaceIcons.values.forEach { slot ->
      positionSurfaceIcon(slot)
    }
  }

  private fun positionSurfaceIcon(slot: SurfaceIconSlot) {
    val iconSizePx = dpToPx(SURFACE_ICON_SIZE_DP)
    val itemView = itemViewAt(slot.index) ?: return
    val iconView = findIconView(itemView)
    val activeIndicator = findActiveIndicatorView(itemView)
    
    if (activeIndicator != null) {
      val desiredWidth = dpToPx(64f)
      val desiredHeight = dpToPx(32f)
      if (activeIndicator.layoutParams?.width != desiredWidth || activeIndicator.layoutParams?.height != desiredHeight) {
        activeIndicator.layoutParams?.width = desiredWidth
        activeIndicator.layoutParams?.height = desiredHeight
        activeIndicator.requestLayout()
      }
      if (activeIndicator.visibility != View.VISIBLE) {
        activeIndicator.visibility = View.VISIBLE
      }
    }

    val anchor = iconView ?: itemView
    if (anchor.width <= 0 || anchor.height <= 0 || iconOverlay.width <= 0) return

    val overlayLocation = IntArray(2)
    val itemLocation = IntArray(2)
    val anchorLocation = IntArray(2)
    iconOverlay.getLocationInWindow(overlayLocation)
    itemView.getLocationInWindow(itemLocation)
    anchor.getLocationInWindow(anchorLocation)

    val slotLeft = itemLocation[0] - overlayLocation[0]
    val slotTop = itemLocation[1] - overlayLocation[1]
    val slotWidth = itemView.width
    val slotHeight = itemView.height
    if (slotWidth <= 0 || slotHeight <= 0) return

    if (
      slot.wrapper.left != slotLeft ||
      slot.wrapper.top != slotTop ||
      slot.wrapper.width != slotWidth ||
      slot.wrapper.height != slotHeight
    ) {
      slot.wrapper.measure(
        MeasureSpec.makeMeasureSpec(slotWidth, MeasureSpec.EXACTLY),
        MeasureSpec.makeMeasureSpec(slotHeight, MeasureSpec.EXACTLY),
      )
      slot.wrapper.layout(slotLeft, slotTop, slotLeft + slotWidth, slotTop + slotHeight)
    }

    val rootLeft = anchorLocation[0] - itemLocation[0] + ((anchor.width - iconSizePx) / 2f)
    val rootTop = anchorLocation[1] - itemLocation[1] + ((anchor.height - iconSizePx) / 2f)
    slot.portal.resizePx(iconSizePx, iconSizePx)
    slot.portal.rootView.layout(
      rootLeft.toInt(),
      rootTop.toInt(),
      rootLeft.toInt() + iconSizePx,
      rootTop.toInt() + iconSizePx,
    )

    slot.wrapper.visibility = if (shouldShowNativeTabBar()) View.VISIBLE else View.INVISIBLE
    slot.wrapper.bringToFront()
    slot.portal.rootView.bringToFront()
    if (iconView != null) {
      iconView.visibility = View.VISIBLE
      iconView.alpha = 0f
    }
  }

  private fun notifySurfaceIcons() {
    post {
      positionSurfaceIcons()
      surfaceIcons.values.forEach { slot ->
        dispatchSurfaceIconEvent("onNativeTabUpdate", slot)
      }
    }
  }

  fun replaySurfaceIconMounts() {
    post {
      positionSurfaceIcons()
      surfaceIcons.values.forEach { slot ->
        dispatchSurfaceIconEvent("onNativeTabMount", slot)
      }
    }
  }

  private fun dispatchSurfaceIconEvent(eventName: String, slot: SurfaceIconSlot) {
    val manager = uiManager ?: return
    if (nodeId == -1) return
    val event = JSONObject()
    event.put("surfaceId", slot.portal.surfaceId)
    event.put("routeKey", slot.routeKey)
    event.put("active", slot.index == selectedIndex)
    manager.dispatchEvent(nodeId, eventName, event)
  }

  private fun findActiveIndicatorView(itemView: BottomNavigationItemView): View? {
    return itemView.findViewById(
      com.google.android.material.R.id.navigation_bar_item_active_indicator_view,
    )
  }

  private fun viewFrame(view: View?): String {
    if (view == null) return "null"
    return "(${view.left},${view.top},${view.width},${view.height})" +
      "[measured=${view.measuredWidth}x${view.measuredHeight} vis=${view.visibility} alpha=${"%.2f".format(view.alpha)} ty=${"%.1f".format(view.translationY)}]"
  }

  private fun measureTabBar(width: Int, height: Int, shouldShow: Boolean): Int {
    if (!shouldShow) return 0
    val insets = ViewCompat.getRootWindowInsets(this)
    val insetBottom = insets?.getInsets(WindowInsetsCompat.Type.navigationBars())?.bottom ?: 0
    val desiredPadding = baseBottomNavPaddingBottom + insetBottom
    if (bottomNav.paddingBottom != desiredPadding) {
      bottomNav.setPadding(
        bottomNav.paddingLeft,
        bottomNav.paddingTop,
        bottomNav.paddingRight,
        desiredPadding,
      )
    }

    bottomNav.measure(
      MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(height, MeasureSpec.AT_MOST),
    )
    return bottomNav.measuredHeight
  }

  private fun dpToPx(dp: Float): Int {
    return (dp * context.resources.displayMetrics.density).toInt()
  }

  private fun updateTabVisibility() {
    for (i in 0 until contentContainer.childCount) {
      val child = contentContainer.getChildAt(i)
      val shouldBeVisible = i == visibleIndex
      val shouldBePending = pendingIndex != null && i == pendingIndex

      if (shouldBeVisible) {
        child.visibility = View.VISIBLE
        child.translationZ = 10f
        child.alpha = 1f
      } else if (shouldBePending) {
        child.visibility = View.VISIBLE
        child.translationZ = 20f
        child.alpha = 0f
      } else {
        child.visibility = View.INVISIBLE
        child.translationZ = 0f
        child.alpha = 0f
      }
    }
  }

  private fun startDeferredSwitch(index: Int) {
    val maxIndex = contentContainer.childCount - 1
    if (maxIndex < 0) return
    val target = index.coerceIn(0, maxIndex)
    if (target == visibleIndex) {
      pendingIndex = null
      updateTabVisibility()
      return
    }

    pendingIndex = target
    pendingStartMs = SystemClock.uptimeMillis()
    updateTabVisibility()
    attachPendingPreDraw()
    schedulePendingCheck()
  }

  private fun attachPendingPreDraw() {
    val pending = pendingIndex ?: return
    if (pending >= contentContainer.childCount) return
    val child = contentContainer.getChildAt(pending) ?: return
    pendingPreDraw?.let {
      child.viewTreeObserver.removeOnPreDrawListener(it)
    }
    val listener = ViewTreeObserver.OnPreDrawListener {
      if (shouldCompleteSwitch(pending)) {
        completePendingSwitch(pending)
        return@OnPreDrawListener false
      }
      true
    }
    pendingPreDraw = listener
    child.viewTreeObserver.addOnPreDrawListener(listener)
  }

  private fun schedulePendingCheck() {
    postOnAnimation {
      val pending = pendingIndex ?: return@postOnAnimation
      if (pending >= contentContainer.childCount) {
        pendingIndex = null
        return@postOnAnimation
      }

      val now = SystemClock.uptimeMillis()
      val timedOut = now - pendingStartMs >= switchTimeoutMs
      if (timedOut || shouldCompleteSwitch(pending)) {
        completePendingSwitch(pending)
      } else {
        schedulePendingCheck()
      }
    }
  }

  private fun completePendingSwitch(index: Int) {
    pendingPreDraw?.let { listener ->
      val child = contentContainer.getChildAt(index)
      child?.viewTreeObserver?.removeOnPreDrawListener(listener)
    }
    pendingPreDraw = null
    visibleIndex = index
    pendingIndex = null
    updateTabVisibility()
  }

  private fun shouldCompleteSwitch(index: Int): Boolean {
    val now = SystemClock.uptimeMillis()
    val elapsed = now - pendingStartMs
    val ready = isChildReady(index)
    if (ready) renderedIndices.add(index)
    if (!renderedIndices.contains(index) && elapsed < minHoldMs) return false
    return ready
  }

  private fun isChildReady(index: Int): Boolean {
    val child = contentContainer.getChildAt(index) ?: return false
    return child.width > 0 && child.height > 0 && child.isAttachedToWindow
  }

  private fun updateTabBarVisibility() {
    val visible = shouldShowNativeTabBar()
    bottomNav.visibility = if (visible) View.VISIBLE else View.GONE
    iconOverlay.visibility = if (visible) View.VISIBLE else View.GONE
    requestLayout()
  }

  private fun shouldShowNativeTabBar(): Boolean {
    return nativeTabBarEnabled && tabBarVisible
  }

  private fun parseColor(colorString: String?): Int? {
    if (colorString.isNullOrEmpty()) return null
    return ZynthColorParser.parse(colorString)
  }

  private fun createColorStateList(activeColor: Int, inactiveColor: Int): ColorStateList {
    val states = arrayOf(
      intArrayOf(android.R.attr.state_checked),
      intArrayOf(-android.R.attr.state_checked),
      intArrayOf(),
    )
    val colors = intArrayOf(activeColor, inactiveColor, inactiveColor)
    return ColorStateList(states, colors)
  }
}
