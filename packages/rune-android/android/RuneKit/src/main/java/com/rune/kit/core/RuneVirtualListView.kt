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
    val parsed = parseItems(items)
    adapter.submitItems(parsed)
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

  private inner class RuneVirtualListAdapter :
    RecyclerView.Adapter<RuneVirtualListAdapter.VirtualViewHolder>() {

    private val items = mutableListOf<VirtualItem>()

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VirtualViewHolder {
      val container = FrameLayout(parent.context).apply {
        layoutParams = RecyclerView.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
      }
      return VirtualViewHolder(container)
    }

    override fun onBindViewHolder(holder: VirtualViewHolder, position: Int) {
      holder.bind(items[position])
    }

    override fun getItemCount(): Int = items.size

    fun submitItems(next: List<VirtualItem>) {
      val diff = DiffUtil.calculateDiff(
        object : DiffUtil.Callback() {
          override fun getOldListSize(): Int = items.size
          override fun getNewListSize(): Int = next.size

          override fun areItemsTheSame(oldItemPosition: Int, newItemPosition: Int): Boolean {
            return items[oldItemPosition].key == next[newItemPosition].key
          }

          override fun areContentsTheSame(oldItemPosition: Int, newItemPosition: Int): Boolean {
            val old = items[oldItemPosition].node
            val new = next[newItemPosition].node
            return old == new
          }
        },
        false,
      )
      items.clear()
      items.addAll(next)
      diff.dispatchUpdatesTo(this)
    }

    inner class VirtualViewHolder(private val container: FrameLayout) :
      RecyclerView.ViewHolder(container) {

      fun bind(item: VirtualItem) {
        container.removeAllViews()
        val node = item.node ?: return
        val child = createView(container.context, node, container)
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
