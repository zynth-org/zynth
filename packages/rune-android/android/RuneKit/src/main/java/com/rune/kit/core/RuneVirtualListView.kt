package com.rune.kit.core

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.util.AttributeSet
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.setPadding
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListUpdateCallback
import androidx.recyclerview.widget.RecyclerView
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

internal class RuneVirtualListView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
) : FrameLayout(context, attrs) {

  private val recyclerView = RecyclerView(context).apply {
    id = View.generateViewId()
    overScrollMode = View.OVER_SCROLL_NEVER
    layoutParams = LayoutParams(
      LayoutParams.MATCH_PARENT,
      LayoutParams.MATCH_PARENT,
    )
    layoutManager = LinearLayoutManager(context)
    adapter = RuneVirtualListAdapter()
  }

  private val adapter: RuneVirtualListAdapter
    get() = recyclerView.adapter as RuneVirtualListAdapter

  init {
    clipChildren = false
    clipToPadding = false
    setBackgroundColor(Color.TRANSPARENT)
    addView(recyclerView)
  }

  fun applyVirtualListState(payload: JSONObject?) {
    val items = payload?.optJSONArray("items")
    val decorators = payload?.optJSONObject("decorators")
    val parsed = parseItems(items)
    adapter.submitData(parsed, decorators)
  }

  fun applyHorizontal(horizontal: Boolean) {
    val orientation = if (horizontal) {
      LinearLayoutManager.HORIZONTAL
    } else {
      LinearLayoutManager.VERTICAL
    }
    (recyclerView.layoutManager as? LinearLayoutManager)?.orientation = orientation
  }

  fun applyContentContainerStyle(style: JSONObject?) {
    if (style == null) {
      recyclerView.setPadding(0)
      recyclerView.background = null
      return
    }

    // Apply padding
    val density = context.resources.displayMetrics.density
    val paddingAll = style.optInt("padding", 0)
    val paddingH = style.optInt("paddingHorizontal", paddingAll)
    val paddingV = style.optInt("paddingVertical", paddingAll)
    val paddingLeft = (style.optInt("paddingLeft", paddingH) * density).roundToInt()
    val paddingRight = (style.optInt("paddingRight", paddingH) * density).roundToInt()
    val paddingTop = (style.optInt("paddingTop", paddingV) * density).roundToInt()
    val paddingBottom = (style.optInt("paddingBottom", paddingV) * density).roundToInt()
    recyclerView.setPadding(paddingLeft, paddingTop, paddingRight, paddingBottom)

    // Apply background color
    val bgColor = style.optString("backgroundColor", null)
    if (bgColor != null) {
      try {
        recyclerView.setBackgroundColor(Color.parseColor(bgColor))
      } catch (e: Exception) {
        // Invalid color, ignore
      }
    }
  }

  fun executeCommand(command: JSONObject) {
    val type = command.optString("type", null) ?: return
    
    when (type) {
      "scrollToOffset" -> {
        val offset = command.optInt("offset", 0)
        val animated = command.optBoolean("animated", true)
        if (animated) {
          recyclerView.smoothScrollBy(0, offset)
        } else {
          recyclerView.scrollBy(0, offset)
        }
      }
      "scrollToIndex" -> {
        // Index refers to data items only, not decorators
        val dataIndex = command.optInt("index", 0)
        val animated = command.optBoolean("animated", true)
        val viewOffset = command.optInt("viewOffset", 0)
        
        // Convert data index to adapter position
        val adapterPosition = adapter.getAdapterPositionFromDataIndex(dataIndex)
        
        if (animated) {
          recyclerView.smoothScrollToPosition(adapterPosition)
        } else {
          (recyclerView.layoutManager as? LinearLayoutManager)?.scrollToPositionWithOffset(adapterPosition, viewOffset)
        }
      }
      "scrollToTop" -> {
        val animated = command.optBoolean("animated", true)
        if (animated) {
          recyclerView.smoothScrollToPosition(0)
        } else {
          (recyclerView.layoutManager as? LinearLayoutManager)?.scrollToPositionWithOffset(0, 0)
        }
      }
      "scrollToEnd" -> {
        val animated = command.optBoolean("animated", true)
        val lastIndex = adapter.itemCount - 1
        if (lastIndex >= 0) {
          if (animated) {
            recyclerView.smoothScrollToPosition(lastIndex)
          } else {
            (recyclerView.layoutManager as? LinearLayoutManager)?.scrollToPositionWithOffset(lastIndex, 0)
          }
        }
      }
      "flashScrollIndicators" -> {
        // Trigger scroll indicators by performing a tiny scroll
        recyclerView.smoothScrollBy(0, 1)
        recyclerView.postDelayed({
          recyclerView.smoothScrollBy(0, -1)
        }, 50)
      }
    }
  }

  private fun parseItems(array: JSONArray?): List<VirtualItem> {
    if (array == null) return emptyList()
    val result = ArrayList<VirtualItem>(array.length())
    for (i in 0 until array.length()) {
      val obj = array.optJSONObject(i) ?: continue
      val key = obj.optString("key", "item-$i")
      val tree = parseNode(obj.optJSONObject("tree"))
      result.add(VirtualItem(key, tree))
    }
    return result
  }

  private fun parseNode(json: JSONObject?): VirtualNode? {
    if (json == null) return null
    return when (json.optString("type")) {
      "view" -> {
        val children = json.optJSONArray("children")
        val parsedChildren = mutableListOf<VirtualNode>()
        if (children != null) {
          for (i in 0 until children.length()) {
            val child = parseNode(children.optJSONObject(i))
            if (child != null) {
              parsedChildren.add(child)
            }
          }
        }
        val styleString = json.optJSONObject("style")?.toString()
        VirtualNode.ViewNode(
          styleJson = styleString,
          pointerEvents = json.optString("pointerEvents", null),
          accessibilityLabel = json.optString("accessibilityLabel", null),
          accessibilityHint = json.optString("accessibilityHint", null),
          accessibilityRole = json.optString("accessibilityRole", null),
          testId = json.optString("testID", null),
          children = parsedChildren,
        )
      }
      "text" -> {
        val styleString = json.optJSONObject("style")?.toString()
        VirtualNode.TextNode(
          text = json.optString("text", ""),
          styleJson = styleString,
          numberOfLines = json.optInt("numberOfLines", -1).takeIf { it >= 0 },
        )
      }
      else -> null
    }
  }

  private data class VirtualItem(
    val key: String,
    val node: VirtualNode?,
  )
  
  private data class DecoratorSet(
    val header: VirtualNode? = null,
    val headerStyle: JSONObject? = null,
    val footer: VirtualNode? = null,
    val footerStyle: JSONObject? = null,
    val empty: VirtualNode? = null,
    val separator: VirtualNode? = null,
  )

  private sealed class VirtualNode {
    data class ViewNode(
      val styleJson: String?,
      val pointerEvents: String?,
      val accessibilityLabel: String?,
      val accessibilityHint: String?,
      val accessibilityRole: String?,
      val testId: String?,
      val children: List<VirtualNode>,
    ) : VirtualNode()

    data class TextNode(
      val text: String,
      val styleJson: String?,
      val numberOfLines: Int?,
    ) : VirtualNode()
  }

  // View type constants for RecyclerView adapter
  private companion object {
    const val VIEW_TYPE_HEADER = 0
    const val VIEW_TYPE_FOOTER = 1
    const val VIEW_TYPE_EMPTY = 2
    const val VIEW_TYPE_DATA = 3
    const val VIEW_TYPE_SEPARATOR = 4
  }

  private inner class RuneVirtualListAdapter :
    RecyclerView.Adapter<RuneVirtualListAdapter.VirtualViewHolder>() {

    private val dataItems = mutableListOf<VirtualItem>()
    private var decorators = DecoratorSet()

    override fun getItemViewType(position: Int): Int {
      // Empty state: header -> empty -> footer
      if (dataItems.isEmpty() && decorators.empty != null) {
        return when (position) {
          0 -> if (decorators.header != null) VIEW_TYPE_HEADER else VIEW_TYPE_EMPTY
          1 -> if (decorators.header != null) VIEW_TYPE_EMPTY else VIEW_TYPE_FOOTER
          2 -> VIEW_TYPE_FOOTER
          else -> VIEW_TYPE_EMPTY
        }
      }

      // Normal mode with separators: header -> (data + separator)* -> footer
      val hasHeader = decorators.header != null
      val hasFooter = decorators.footer != null
      val hasSeparator = decorators.separator != null

      return when {
        hasHeader && position == 0 -> VIEW_TYPE_HEADER
        hasFooter && position == itemCount - 1 -> VIEW_TYPE_FOOTER
        hasSeparator -> {
          // With separators: positions alternate between data and separator
          // Adjust for header
          val adjustedPos = if (hasHeader) position - 1 else position
          if (adjustedPos % 2 == 0) VIEW_TYPE_DATA else VIEW_TYPE_SEPARATOR
        }
        else -> VIEW_TYPE_DATA
      }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VirtualViewHolder {
      val container = FrameLayout(parent.context).apply {
        layoutParams = RecyclerView.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
      }
      return VirtualViewHolder(container, viewType)
    }

    override fun onBindViewHolder(holder: VirtualViewHolder, position: Int) {
      when (holder.viewType) {
        VIEW_TYPE_HEADER -> holder.bind(VirtualItem("__header", decorators.header), decorators.headerStyle)
        VIEW_TYPE_FOOTER -> holder.bind(VirtualItem("__footer", decorators.footer), decorators.footerStyle)
        VIEW_TYPE_EMPTY -> holder.bind(VirtualItem("__empty", decorators.empty), null)
        VIEW_TYPE_SEPARATOR -> holder.bind(VirtualItem("__separator", decorators.separator), null)
        VIEW_TYPE_DATA -> {
          val dataIndex = getDataIndexFromPosition(position)
          if (dataIndex in dataItems.indices) {
            holder.bind(dataItems[dataIndex], null)
          }
        }
      }
    }

    override fun getItemCount(): Int {
      // Empty state: header? + empty + footer?
      if (dataItems.isEmpty() && decorators.empty != null) {
        var count = 1 // empty
        if (decorators.header != null) count++
        if (decorators.footer != null) count++
        return count
      }

      // Normal mode
      val hasHeader = decorators.header != null
      val hasFooter = decorators.footer != null
      val hasSeparator = decorators.separator != null

      var count = dataItems.size
      if (hasSeparator && count > 0) {
        // Add separators between items (n-1 separators for n items)
        count += (dataItems.size - 1)
      }
      if (hasHeader) count++
      if (hasFooter) count++
      return count
    }

    private fun getDataIndexFromPosition(position: Int): Int {
      val hasHeader = decorators.header != null
      val hasSeparator = decorators.separator != null

      var adjustedPos = position
      if (hasHeader) adjustedPos--

      return if (hasSeparator) {
        // With separators, data items are at even positions
        adjustedPos / 2
      } else {
        adjustedPos
      }
    }

    fun getAdapterPositionFromDataIndex(dataIndex: Int): Int {
      val hasHeader = decorators.header != null
      val hasSeparator = decorators.separator != null

      var position = dataIndex
      if (hasSeparator) {
        // With separators, each data item takes 2 positions (data + separator)
        position *= 2
      }
      if (hasHeader) {
        position++
      }
      return position
    }

    fun submitData(dataList: List<VirtualItem>, decoratorsJson: JSONObject?) {
      // Parse decorators
      val newDecorators = parseDecorators(decoratorsJson)
      
      // Calculate diff for data items only (maintains perfect measurement accuracy)
      val diff = DiffUtil.calculateDiff(
        object : DiffUtil.Callback() {
          override fun getOldListSize(): Int = dataItems.size
          override fun getNewListSize(): Int = dataList.size

          override fun areItemsTheSame(oldItemPosition: Int, newItemPosition: Int): Boolean {
            return dataItems[oldItemPosition].key == dataList[newItemPosition].key
          }

          override fun areContentsTheSame(oldItemPosition: Int, newItemPosition: Int): Boolean {
            val old = dataItems[oldItemPosition].node
            val new = dataList[newItemPosition].node
            return old == new
          }
        },
        false,
      )
      
      val oldHasHeader = decorators.header != null
      val oldHasFooter = decorators.footer != null
      val oldHasSeparator = decorators.separator != null
      val oldIsEmpty = dataItems.isEmpty() && decorators.empty != null
      
      val newHasHeader = newDecorators.header != null
      val newHasFooter = newDecorators.footer != null
      val newHasSeparator = newDecorators.separator != null
      val newIsEmpty = dataList.isEmpty() && newDecorators.empty != null
      
      // Update state
      dataItems.clear()
      dataItems.addAll(dataList)
      decorators = newDecorators
      
      // Notify changes carefully to avoid scroll jumps
      if (oldIsEmpty != newIsEmpty || 
          oldHasHeader != newHasHeader || 
          oldHasFooter != newHasFooter ||
          oldHasSeparator != newHasSeparator) {
        // Structure changed significantly, full refresh
        notifyDataSetChanged()
      } else {
        // Apply data diffs while preserving decorator positions
        val headerOffset = if (newHasHeader) 1 else 0
        val separatorMultiplier = if (newHasSeparator) 2 else 1
        
        diff.dispatchUpdatesTo(object : ListUpdateCallback {
          override fun onInserted(position: Int, count: Int) {
            val adapterPos = headerOffset + (position * separatorMultiplier)
            notifyItemRangeInserted(adapterPos, count * separatorMultiplier)
          }

          override fun onRemoved(position: Int, count: Int) {
            val adapterPos = headerOffset + (position * separatorMultiplier)
            notifyItemRangeRemoved(adapterPos, count * separatorMultiplier)
          }

          override fun onMoved(fromPosition: Int, toPosition: Int) {
            val fromPos = headerOffset + (fromPosition * separatorMultiplier)
            val toPos = headerOffset + (toPosition * separatorMultiplier)
            notifyItemMoved(fromPos, toPos)
          }

          override fun onChanged(position: Int, count: Int, payload: Any?) {
            val adapterPos = headerOffset + (position * separatorMultiplier)
            notifyItemRangeChanged(adapterPos, count * separatorMultiplier, payload)
          }
        })
      }
    }

    private fun parseDecorators(json: JSONObject?): DecoratorSet {
      if (json == null) return DecoratorSet()
      
      val header = json.optJSONObject("header")?.let { obj ->
        parseNode(obj.optJSONObject("tree"))
      }
      val headerStyle = json.optJSONObject("header")?.optJSONObject("style")
      
      val footer = json.optJSONObject("footer")?.let { obj ->
        parseNode(obj.optJSONObject("tree"))
      }
      val footerStyle = json.optJSONObject("footer")?.optJSONObject("style")
      
      val empty = json.optJSONObject("empty")?.let { obj ->
        parseNode(obj.optJSONObject("tree"))
      }
      
      val separator = json.optJSONObject("separator")?.let { obj ->
        parseNode(obj.optJSONObject("tree"))
      }
      
      return DecoratorSet(header, headerStyle, footer, footerStyle, empty, separator)
    }

    inner class VirtualViewHolder(
      private val container: FrameLayout,
      val viewType: Int
    ) : RecyclerView.ViewHolder(container) {

      fun bind(item: VirtualItem, styleOverride: JSONObject? = null) {
        container.removeAllViews()
        val node = item.node ?: return
        val child = createView(container.context, node, container)
        
        // Apply style override for header/footer
        if (styleOverride != null && child is ViewGroup) {
          applyStyle(child, styleOverride)
        }
        
        container.addView(child)
      }
    }
  }

  private fun createView(context: Context, node: VirtualNode, parent: ViewGroup): View {
    return when (node) {
      is VirtualNode.ViewNode -> {
        val layout = LinearLayout(context).apply {
          orientation = LinearLayout.VERTICAL
          clipChildren = false
          clipToPadding = false
        }
        node.testId?.let { layout.tag = it }
        node.accessibilityLabel?.let { layout.contentDescription = it }
        val style = node.styleJson?.let { runCatching { JSONObject(it) }.getOrNull() }
        applyStyle(layout, style)
        for (child in node.children) {
          val view = createView(context, child, layout)
          layout.addView(view)
        }
        applyLayoutParams(layout, style, parent)
        layout
      }
      is VirtualNode.TextNode -> {
        val textView = TextView(context)
        textView.text = node.text
        node.numberOfLines?.let {
          textView.maxLines = it
          textView.ellipsize = TextUtils.TruncateAt.END
        }
        val style = node.styleJson?.let { runCatching { JSONObject(it) }.getOrNull() }
        applyTextStyle(textView, style)
        applyLayoutParams(textView, style, parent)
        textView
      }
    }
  }

  private fun applyLayoutParams(view: View, style: JSONObject?, parent: ViewGroup) {
    val params = when (parent) {
      is LinearLayout -> LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      )
      else -> ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      )
    }
    if (params is ViewGroup.MarginLayoutParams) {
      val margin = style?.optDouble("margin", Double.NaN)
      if (margin != null && !margin.isNaN()) {
        val px = dpToPx(margin)
        params.setMargins(px, px, px, px)
      }
      style?.optDouble("marginTop", Double.NaN)?.let {
        if (!it.isNaN()) params.topMargin = dpToPx(it)
      }
      style?.optDouble("marginBottom", Double.NaN)?.let {
        if (!it.isNaN()) params.bottomMargin = dpToPx(it)
      }
      style?.optDouble("marginLeft", Double.NaN)?.let {
        if (!it.isNaN()) params.leftMargin = dpToPx(it)
      }
      style?.optDouble("marginRight", Double.NaN)?.let {
        if (!it.isNaN()) params.rightMargin = dpToPx(it)
      }
    }
    view.layoutParams = params
  }

  private fun applyStyle(view: View, style: JSONObject?) {
    if (style == null) return
    style.optString("backgroundColor", null)?.let { colorString ->
      parseColorSafely(colorString)?.let { color ->
        val radius = style.optDouble("borderRadius", Double.NaN)
        if (!radius.isNaN()) {
          val drawable = GradientDrawable().apply {
            setColor(color)
            cornerRadius = dpToPxF(radius)
          }
          view.background = drawable
        } else {
          view.setBackgroundColor(color)
        }
      }
    }

    val padding = style.optDouble("padding", Double.NaN)
    if (!padding.isNaN()) {
      val px = dpToPx(padding)
      view.setPadding(px)
    } else {
      val paddingHorizontal = style.optDouble("paddingHorizontal", Double.NaN)
      val paddingVertical = style.optDouble("paddingVertical", Double.NaN)
      val left = style.optDouble("paddingLeft", Double.NaN)
      val top = style.optDouble("paddingTop", Double.NaN)
      val right = style.optDouble("paddingRight", Double.NaN)
      val bottom = style.optDouble("paddingBottom", Double.NaN)
      if (!paddingHorizontal.isNaN() || !paddingVertical.isNaN() ||
        !left.isNaN() || !top.isNaN() || !right.isNaN() || !bottom.isNaN()
      ) {
        val horizontal = if (!paddingHorizontal.isNaN()) dpToPx(paddingHorizontal) else null
        val vertical = if (!paddingVertical.isNaN()) dpToPx(paddingVertical) else null
        val resolvedLeft = if (!left.isNaN()) dpToPx(left) else horizontal ?: 0
        val resolvedRight = if (!right.isNaN()) dpToPx(right) else horizontal ?: 0
        val resolvedTop = if (!top.isNaN()) dpToPx(top) else vertical ?: 0
        val resolvedBottom = if (!bottom.isNaN()) dpToPx(bottom) else vertical ?: 0
        view.setPadding(resolvedLeft, resolvedTop, resolvedRight, resolvedBottom)
      }
    }
  }

  private fun applyTextStyle(textView: TextView, style: JSONObject?) {
    if (style == null) return
    applyStyle(textView, style)

    style.optDouble("fontSize", Double.NaN).let {
      if (!it.isNaN()) {
        textView.setTextSize(TypedValue.COMPLEX_UNIT_DIP, it.toFloat())
      }
    }
    style.optString("color", null)?.let { color ->
      parseColorSafely(color)?.let { textView.setTextColor(it) }
    }
    style.optString("fontWeight", null)?.let { weight ->
      textView.paint.isFakeBoldText = weight.equals("bold", ignoreCase = true) ||
        weight.toIntOrNull()?.let { value -> value >= 600 } == true
    }
  }

  private fun parseColorSafely(value: String): Int? {
    return runCatching { Color.parseColor(value) }.getOrNull()
  }

  private fun dpToPx(value: Double): Int {
    val density = resources.displayMetrics.density
    return (value * density).roundToInt()
  }

  private fun dpToPxF(value: Double): Float {
    val density = resources.displayMetrics.density
    return (value * density).toFloat()
  }
}
