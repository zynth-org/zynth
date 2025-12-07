package com.rune.components.menu

import android.content.Context
import android.graphics.Color
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.view.Gravity
import android.view.Menu
import android.view.View
import android.widget.FrameLayout
import androidx.appcompat.view.ContextThemeWrapper
import androidx.appcompat.widget.PopupMenu
import com.google.android.material.color.MaterialColors
import com.rune.kit.core.RuneUIManager

class RuneMenuView(context: Context) : FrameLayout(context) {
  var manager: RuneUIManager? = null
  var nodeId: Int = -1
  var hasOnOpenHandler = false
  var hasOnCloseHandler = false

  private var triggerView: RuneMenuTriggerView? = null
  private var activePopup: PopupMenu? = null

  init {
    clipChildren = false
    clipToPadding = false
  }

  override fun onViewAdded(child: View) {
    super.onViewAdded(child)
    if (child is RuneMenuTriggerView) {
      attachTrigger(child)
    }
  }

  override fun onViewRemoved(child: View) {
    super.onViewRemoved(child)
    if (child === triggerView) {
      triggerView?.menuView = null
      triggerView = null
    }
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    activePopup?.dismiss()
    activePopup = null
  }

  private fun attachTrigger(trigger: RuneMenuTriggerView) {
    if (triggerView === trigger) return
    triggerView?.menuView = null
    triggerView = trigger
    trigger.menuView = this
  }

  fun showMenuFromTrigger(anchor: View) {
    if (!isAttachedToWindow) return
    if (activePopup != null) {
      activePopup?.dismiss()
      activePopup = null
    }

    val menuItems = collectMenuItems()
    if (menuItems.isEmpty()) return

    val popup = createPopupMenu(anchor)
    val itemMap = LinkedHashMap<Int, RuneMenuItemView>()

    menuItems.forEachIndexed { index, itemView ->
      val itemId = if (itemView.nodeId >= 0) itemView.nodeId else View.generateViewId()
      val title = itemView.label ?: ""
      val menuTitle = if (itemView.destructive) {
        createDestructiveTitle(anchor, title)
      } else {
        title
      }

      val menuItem = popup.menu.add(Menu.NONE, itemId, index, menuTitle)
      menuItem.isEnabled = !itemView.disabled
      itemView.createIconDrawable()?.let { menuItem.icon = it }
      itemMap[itemId] = itemView
    }

    popup.setForceShowIcon(true)
    popup.setOnMenuItemClickListener { item ->
      val itemView = itemMap[item.itemId]
      if (itemView != null) {
        if (itemView.hasOnPressHandler) {
          itemView.manager?.dispatchEvent(itemView.nodeId, "onPress", null)
        }
        true
      } else {
        false
      }
    }
    popup.setOnDismissListener {
      activePopup = null
      if (hasOnCloseHandler) {
        manager?.dispatchEvent(nodeId, "onClose", null)
      }
    }

    activePopup = popup
    if (hasOnOpenHandler) {
      manager?.dispatchEvent(nodeId, "onOpen", null)
    }
    popup.show()
  }

  private fun collectMenuItems(): List<RuneMenuItemView> {
    val items = ArrayList<RuneMenuItemView>()
    for (i in 0 until childCount) {
      val child = getChildAt(i)
      if (child is RuneMenuItemView) {
        items.add(child)
      }
    }
    return items
  }

  private fun createPopupMenu(anchor: View): PopupMenu {
    val themedContext = resolvePopupMenuContext(anchor.context)
    return PopupMenu(themedContext, anchor, Gravity.NO_GRAVITY)
  }

  private fun resolvePopupMenuContext(base: Context): Context {
    val resId = base.resources.getIdentifier(
      "ThemeOverlay_Material3_PopupMenu",
      "style",
      "com.google.android.material",
    )
    return if (resId != 0) {
      ContextThemeWrapper(base, resId)
    } else {
      base
    }
  }

  private fun createDestructiveTitle(anchor: View, title: String): CharSequence {
    if (title.isEmpty()) return title
    val color = MaterialColors.getColor(
      anchor,
      com.google.android.material.R.attr.colorError,
      Color.RED,
    )
    return SpannableString(title).apply {
      setSpan(ForegroundColorSpan(color), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
  }

  fun reset() {
    hasOnOpenHandler = false
    hasOnCloseHandler = false
    triggerView?.menuView = null
    triggerView = null
    activePopup?.dismiss()
    activePopup = null
    manager = null
    nodeId = -1
  }
}
