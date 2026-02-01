package com.zynth.screens

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.View.MeasureSpec
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.os.SystemClock
import android.view.ViewTreeObserver
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.children
import com.google.android.material.bottomnavigation.BottomNavigationItemView
import com.google.android.material.bottomnavigation.BottomNavigationMenuView
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.google.android.material.navigation.NavigationBarView
import com.zynth.kit.core.ZynthRootView
import com.zynth.kit.core.ZynthUIManager
import org.json.JSONArray
import org.json.JSONObject

@SuppressLint("ViewConstructor")
class ScreenTabsContainerView(context: Context) : LinearLayout(context) {

  companion object {
    private const val SURFACE_ICON_TAG_PREFIX = "zynth_tab_surface_icon:"
  }

  private var uiManager: ZynthUIManager? = null
  private var nodeId: Int = -1
  private val contentContainer: FrameLayout
  private val bottomNav: BottomNavigationView

  private var selectedIndex: Int = 0
  private var visibleIndex: Int = 0
  private var pendingIndex: Int? = null
  private var pendingStartMs: Long = 0L
  private var pendingPreDraw: ViewTreeObserver.OnPreDrawListener? = null
  private var tabAnimation: ScreenAnimation = ScreenAnimation.NONE
  private var nativeTabBarEnabled: Boolean = false
  private var tabBarVisible: Boolean = true
  private val iconSurfaces = mutableMapOf<String, Int>()
  private var lastTabBarItemsJson: String? = null
  private val pendingInsertIndices = HashMap<View, Int>()
  private val renderedIndices = HashSet<Int>()
  private val minHoldMs = 200L
  private val switchTimeoutMs = 700L
  private val baseBottomNavPaddingBottom: Int

  init {
    orientation = VERTICAL
    clipChildren = false
    clipToPadding = false

    contentContainer = object : FrameLayout(context) {
      override fun addView(child: View?, index: Int, params: ViewGroup.LayoutParams?) {
        super.addView(child, index, params)
        updateTabVisibility()
      }

      override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        // Preserve Yoga-driven child layouts set by the UI manager.
        for (i in 0 until childCount) {
          val child = getChildAt(i)
          child.layout(child.left, child.top, child.right, child.bottom)
        }
      }
    }
    val contentParams = LayoutParams(LayoutParams.MATCH_PARENT, 0)
    contentParams.weight = 1f
    super.addView(contentContainer, contentParams)

    bottomNav = BottomNavigationView(context)
    bottomNav.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT)
    bottomNav.clipChildren = false
    bottomNav.clipToPadding = false
    bottomNav.labelVisibilityMode = NavigationBarView.LABEL_VISIBILITY_LABELED
    bottomNav.setOnItemSelectedListener { item ->
      val index = item.itemId
      if (index != selectedIndex) {
        if (uiManager != null && nodeId != -1) {
          val event = JSONObject()
          event.put("index", index)
          uiManager?.dispatchEvent(nodeId, "onNativeTabSelect", event)
        }
      }
      true
    }
    bottomNav.visibility = View.GONE
    super.addView(bottomNav)

    baseBottomNavPaddingBottom = bottomNav.paddingBottom
  }

  override fun addView(child: View?, index: Int, params: ViewGroup.LayoutParams?) {
    if (child === contentContainer || child === bottomNav) {
      super.addView(child, index, params)
    } else {
      val desiredIndex = child?.let { pendingInsertIndices.remove(it) } ?: index
      contentContainer.addView(child, desiredIndex, params)
    }
  }

  override fun removeView(child: View?) {
    if (child === contentContainer || child === bottomNav) {
      super.removeView(child)
    } else {
      contentContainer.removeView(child)
    }
  }

  fun trackInsertIndex(child: View, index: Int) {
    pendingInsertIndices[child] = index
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val measuredWidth = MeasureSpec.getSize(widthMeasureSpec)
    val measuredHeight = MeasureSpec.getSize(heightMeasureSpec)
    setMeasuredDimension(measuredWidth, measuredHeight)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val width = right - left
    val height = bottom - top
    if (width <= 0 || height <= 0) return

    val shouldShow = nativeTabBarEnabled && tabBarVisible
    val tabBarHeight = if (shouldShow) {
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
      val widthSpec = MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY)
      val heightSpec = MeasureSpec.makeMeasureSpec(height, MeasureSpec.AT_MOST)
      bottomNav.measure(widthSpec, heightSpec)
      bottomNav.measuredHeight
    } else {
      0
    }

    val contentBottom = height - tabBarHeight
    contentContainer.layout(0, 0, width, contentBottom)

    if (shouldShow) {
      bottomNav.layout(0, contentBottom, width, contentBottom + tabBarHeight)
    }
  }

  fun setUIManager(manager: ZynthUIManager) {
    this.uiManager = manager
  }

  fun setNodeId(id: Int) {
    this.nodeId = id
  }

  fun setSelectedIndex(index: Int) {
    if (selectedIndex != index) {
      selectedIndex = index
      if (nativeTabBarEnabled && bottomNav.menu.size() > index) {
        bottomNav.menu.getItem(index).isChecked = true
      }
      startDeferredSwitch(index)
      notifySurfacesUpdate()
    }
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
      tabBarVisible = options.optBoolean("visible", true)

      if (backgroundColor != null) {
        bottomNav.setBackgroundColor(backgroundColor)
      }

      if (activeColor != null || inactiveColor != null) {
        val active = activeColor ?: Color.BLUE
        val inactive = inactiveColor ?: Color.GRAY
        val colorStateList = createColorStateList(active, inactive)
        bottomNav.itemIconTintList = colorStateList
        bottomNav.itemTextColor = colorStateList
      }

      val showLabels = options.optBoolean("showLabels", true)
      bottomNav.labelVisibilityMode = if (showLabels)
        NavigationBarView.LABEL_VISIBILITY_LABELED
      else
        NavigationBarView.LABEL_VISIBILITY_UNLABELED
    } catch (_: Exception) {
      // Ignore malformed options
    }

    updateTabBarVisibility()
  }

  fun setTabBarItems(json: String) {
    if (json == lastTabBarItemsJson) return
    lastTabBarItemsJson = json

    try {
      val items = JSONArray(json)
      val menu = bottomNav.menu

      uiManager?.let { manager ->
        iconSurfaces.values.forEach { surfaceId ->
          runCatching { manager.unregisterSurface(surfaceId) }
        }
      }

      menu.clear()
      iconSurfaces.clear()
      val iconSizePx = dpToPx(24f)
      bottomNav.itemIconSize = iconSizePx

      val pendingSurfaceIcons = mutableListOf<Pair<Int, String>>()

      for (i in 0 until items.length()) {
        val item = items.getJSONObject(i)
        val routeKey = item.getString("key")
        val label = item.optString("label", routeKey)

        val menuItem = menu.add(0, i, i, label)

        if (item.has("badge")) {
          val badge = bottomNav.getOrCreateBadge(i)
          val badgeVal = item.getString("badge")
          try {
            badge.number = badgeVal.toInt()
            badge.isVisible = true
          } catch (_: NumberFormatException) {
            badge.isVisible = true
          }
          if (item.has("badgeColor")) {
            val badgeColor = parseColor(item.getString("badgeColor"))
            if (badgeColor != null) badge.backgroundColor = badgeColor
          }
        } else {
          bottomNav.removeBadge(i)
        }

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

      if (menu.size() > selectedIndex) {
        menu.getItem(selectedIndex).isChecked = true
      }

      if (pendingSurfaceIcons.isNotEmpty()) {
        bottomNav.post {
          bottomNav.post {
            pendingSurfaceIcons.forEach { (index, routeKey) ->
              mountSurfaceIcon(index, routeKey)
            }
          }
        }
      }
    } catch (_: Exception) {
      // Ignore malformed items
    }
  }

  @SuppressLint("RestrictedApi")
  private fun mountSurfaceIcon(index: Int, routeKey: String) {
    val manager = uiManager ?: return

    val menuView = bottomNav.getChildAt(0) as? BottomNavigationMenuView ?: return
    if (index >= menuView.childCount) return
    val itemView = menuView.getChildAt(index) as? BottomNavigationItemView ?: return

    val existingWrapper = itemView.findViewWithTag<View>("$SURFACE_ICON_TAG_PREFIX$routeKey")
    if (existingWrapper != null) {
      val existingSurface = (existingWrapper as? ViewGroup)
        ?.children
        ?.firstOrNull { it is ZynthRootView } as? ZynthRootView
      if (existingSurface != null) {
        iconSurfaces[routeKey] = existingSurface.rootId
        val event = JSONObject()
        event.put("surfaceId", existingSurface.rootId)
        event.put("routeKey", routeKey)
        event.put("active", index == selectedIndex)
        manager.dispatchEvent(nodeId, "onNativeTabUpdate", event)
      }
      return
    }

    for (i in 0 until itemView.childCount) {
      val child = itemView.getChildAt(i)
      if (child is ZynthRootView) {
        iconSurfaces[routeKey] = child.rootId
        val event = JSONObject()
        event.put("surfaceId", child.rootId)
        event.put("routeKey", routeKey)
        event.put("active", index == selectedIndex)
        manager.dispatchEvent(nodeId, "onNativeTabUpdate", event)
        return
      }
    }

    fun findIconView(group: ViewGroup): ImageView? {
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

    val defaultIcon: ImageView? = findIconView(itemView)
    val iconContainer: ViewGroup? =
      itemView.findViewById(com.google.android.material.R.id.navigation_bar_item_icon_container)
        as? ViewGroup
        ?: (defaultIcon?.parent as? ViewGroup)

    val rootId = ZynthRootView.allocateRootId()
    val surfaceView = ZynthRootView(context, rootId)
    surfaceView.isClickable = false
    surfaceView.isFocusable = false

    val iconSizePx = dpToPx(24f)
    val wrapper = FrameLayout(context).apply {
      tag = "$SURFACE_ICON_TAG_PREFIX$routeKey"
      clipChildren = false
      clipToPadding = false
      layoutParams = FrameLayout.LayoutParams(iconSizePx, iconSizePx).apply {
        gravity = Gravity.CENTER
      }
      addView(
        surfaceView,
        FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT,
        ),
      )
    }

    itemView.clipChildren = false
    itemView.clipToPadding = false

    if (iconContainer != null) {
      iconContainer.clipChildren = false
      iconContainer.clipToPadding = false
      iconContainer.minimumWidth = dpToPx(64f)
      iconContainer.minimumHeight = dpToPx(32f)
      var insertIndex = -1
      if (defaultIcon != null) {
        insertIndex = iconContainer.indexOfChild(defaultIcon)
        defaultIcon.visibility = View.VISIBLE
      }

      if (insertIndex >= 0) {
        iconContainer.addView(wrapper, insertIndex)
      } else {
        iconContainer.addView(wrapper)
      }
      iconContainer.requestLayout()
    } else {
      (wrapper.layoutParams as? FrameLayout.LayoutParams)?.apply {
        gravity = Gravity.CENTER_HORIZONTAL or Gravity.TOP
        topMargin = dpToPx(12f)
      }
      itemView.addView(wrapper)
    }
    itemView.requestLayout()
    bottomNav.requestLayout()

    wrapper.post {
      val wrapperW = wrapper.width
      val wrapperH = wrapper.height
      val surfaceW = surfaceView.width
      val surfaceH = surfaceView.height
      if (wrapperW == 0 || wrapperH == 0 || surfaceW == 0 || surfaceH == 0) {
        val sizeSpec = MeasureSpec.makeMeasureSpec(iconSizePx, MeasureSpec.EXACTLY)
        runCatching {
          wrapper.measure(sizeSpec, sizeSpec)
          wrapper.layout(0, 0, iconSizePx, iconSizePx)
          surfaceView.measure(sizeSpec, sizeSpec)
          surfaceView.layout(0, 0, iconSizePx, iconSizePx)
        }
      }

      val desiredContainerW = dpToPx(64f)
      val desiredContainerH = dpToPx(32f)

      if (iconContainer != null &&
        (iconContainer.width != desiredContainerW || iconContainer.height != desiredContainerH)
      ) {
        val containerWSpec = MeasureSpec.makeMeasureSpec(desiredContainerW, MeasureSpec.EXACTLY)
        val containerHSpec = MeasureSpec.makeMeasureSpec(desiredContainerH, MeasureSpec.EXACTLY)

        val currentW = iconContainer.width
        val dx = (desiredContainerW - currentW) / 2
        val newLeft = iconContainer.left - dx

        runCatching {
          iconContainer.measure(containerWSpec, containerHSpec)
          iconContainer.layout(
            newLeft,
            iconContainer.top,
            newLeft + desiredContainerW,
            iconContainer.top + desiredContainerH,
          )
        }
      }

      val activeIndicator = itemView.findViewById<View>(
        com.google.android.material.R.id.navigation_bar_item_active_indicator_view
      )
      if (activeIndicator != null && (activeIndicator.width == 0 || activeIndicator.height == 0)) {
        val targetW = dpToPx(64f)
        val targetH = dpToPx(32f)

        val wSpec = MeasureSpec.makeMeasureSpec(targetW, MeasureSpec.EXACTLY)
        val hSpec = MeasureSpec.makeMeasureSpec(targetH, MeasureSpec.EXACTLY)

        runCatching {
          activeIndicator.measure(wSpec, hSpec)

          val parentW = if (iconContainer != null && iconContainer.width > 0)
            iconContainer.width
          else
            targetW
          val parentH = if (iconContainer != null && iconContainer.height > 0)
            iconContainer.height
          else
            targetH

          val left = (parentW - targetW) / 2
          val top = (parentH - targetH) / 2

          activeIndicator.layout(left, top, left + targetW, top + targetH)
          activeIndicator.translationY = dpToPx(1f).toFloat()
          activeIndicator.alpha = if (index == selectedIndex) 1f else 0f
          activeIndicator.visibility = View.VISIBLE
        }
      }
    }

    manager.registerSurface(rootId, surfaceView)
    iconSurfaces[routeKey] = rootId

    val event = JSONObject()
    event.put("surfaceId", rootId)
    event.put("routeKey", routeKey)
    event.put("active", index == selectedIndex)
    manager.dispatchEvent(nodeId, "onNativeTabMount", event)
  }

  private fun dpToPx(dp: Float): Int {
    return (dp * context.resources.displayMetrics.density).toInt()
  }

  private fun notifySurfacesUpdate() {
    post {
      val manager = uiManager ?: return@post
      if (nodeId == -1) return@post

      iconSurfaces.forEach { (routeKey, surfaceId) ->
        val event = JSONObject()
        event.put("surfaceId", surfaceId)
        event.put("routeKey", routeKey)
        manager.dispatchEvent(nodeId, "onNativeTabUpdate", event)
      }
    }
  }

  private fun updateTabVisibility() {
    for (i in 0 until contentContainer.childCount) {
      val child = contentContainer.getChildAt(i)
      val shouldBeVisible = (i == visibleIndex)
      val shouldBePending = (pendingIndex != null && i == pendingIndex)

      if (shouldBeVisible) {
        if (child.visibility != View.VISIBLE) {
          child.visibility = View.VISIBLE
          child.translationZ = 10f
          child.alpha = 1f
        } else {
          if (child.translationZ != 10f) child.translationZ = 10f
          if (child.alpha != 1f) child.alpha = 1f
        }
      } else if (shouldBePending) {
        if (child.visibility != View.VISIBLE) {
          child.visibility = View.VISIBLE
          child.translationZ = 20f
          child.alpha = 0f
        } else {
          if (child.translationZ != 20f) child.translationZ = 20f
          if (child.alpha != 0f) child.alpha = 0f
        }
      } else {
        if (child.visibility != View.INVISIBLE) {
          child.visibility = View.INVISIBLE
          child.translationZ = 0f
          child.alpha = 0f
        } else {
          if (child.translationZ != 0f) child.translationZ = 0f
          if (child.alpha != 0f) child.alpha = 0f
        }
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
      val timedOut = (now - pendingStartMs) >= switchTimeoutMs
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
    if (ready) {
      renderedIndices.add(index)
    }
    if (!renderedIndices.contains(index) && elapsed < minHoldMs) return false
    return ready
  }

  private fun isChildReady(index: Int): Boolean {
    val child = contentContainer.getChildAt(index) ?: return false
    return child.width > 0 && child.height > 0 && child.isAttachedToWindow
  }

  private fun updateTabBarVisibility() {
    val shouldShow = nativeTabBarEnabled && tabBarVisible
    bottomNav.visibility = if (shouldShow) View.VISIBLE else View.GONE
  }

  private fun parseColor(colorString: String?): Int? {
    if (colorString.isNullOrEmpty()) return null
    return try {
      Color.parseColor(colorString)
    } catch (_: Exception) {
      null
    }
  }

  private fun createColorStateList(activeColor: Int, inactiveColor: Int): ColorStateList {
    val states = arrayOf(
      intArrayOf(android.R.attr.state_checked),
      intArrayOf(-android.R.attr.state_checked),
      intArrayOf(),
    )
    val colors = intArrayOf(
      activeColor,
      inactiveColor,
      inactiveColor,
    )
    return ColorStateList(states, colors)
  }
}
