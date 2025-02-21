package com.rune.kit.core

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.util.AttributeSet
import android.util.LruCache
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.VisibleForTesting
import androidx.core.view.setPadding
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListUpdateCallback
import androidx.recyclerview.widget.RecyclerView
import com.rune.kit.layout.LayoutEngine
import com.rune.kit.layout.Rect
import com.rune.kit.layout.Style
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

internal class RuneVirtualListView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
  private val engine: LayoutEngine? = null,
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

  private var layoutEngine: LayoutEngine? = null
  private var nextYogaNodeId = 1000000 // Start with high ID to avoid conflicts

  init {
    clipChildren = false
    clipToPadding = false
    setBackgroundColor(Color.TRANSPARENT)
    addView(recyclerView)
    // Use the injected engine if provided
    if (engine != null) {
      layoutEngine = engine
    }
  }

  private val cacheStats = CacheStats()
  private val structureHashByKey = mutableMapOf<String, String>()
  private val structureUsageCounts = mutableMapOf<String, Int>()
  private val decoratorHashes = mutableMapOf<String, String>()
  private val styleCache = object : LruCache<String, Style>(STYLE_CACHE_SIZE) {}
  private var currentTemplateVersion: String? = null
  private var currentLayoutInvalidationKey: String? = null
  private val yogaLayoutCache = object : LruCache<String, CachedLayout>(MAX_CACHE_NODE_COUNT) {
    override fun sizeOf(key: String, value: CachedLayout): Int = value.nodeCount

    override fun entryRemoved(evicted: Boolean, key: String, oldValue: CachedLayout, newValue: CachedLayout?) {
      if (evicted) {
        cacheStats.recordEviction()
        maybeLogCacheStats("evicted:$key")
      }
    }
  }

  fun setLayoutEngine(engine: LayoutEngine) {
    this.layoutEngine = engine
  }

  private fun getNextYogaNodeId(): Int {
    return nextYogaNodeId++
  }

  fun applyVirtualListState(payload: JSONObject?) {
    val templateVersion = payload?.opt("templateVersion")
      ?.takeIf { it != JSONObject.NULL }
      ?.toString()
    if (templateVersion != currentTemplateVersion) {
      currentTemplateVersion = templateVersion
      invalidateAllCaches("template-version:${templateVersion ?: "cleared"}")
    }

    val layoutInvalidationKey = payload?.opt("layoutInvalidationKey")
      ?.takeIf { it != JSONObject.NULL }
      ?.toString()
    if (layoutInvalidationKey != currentLayoutInvalidationKey) {
      currentLayoutInvalidationKey = layoutInvalidationKey
      invalidateAllCaches("layout-key:${layoutInvalidationKey ?: "cleared"}")
    }

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
      result.add(VirtualItem(key, tree, tree?.computeStructureHash()))
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
    val structureHash: String? = null,
  )
  
  private data class DecoratorSet(
    val header: VirtualNode? = null,
    val headerStyle: JSONObject? = null,
    val headerHash: String? = null,
    val footer: VirtualNode? = null,
    val footerStyle: JSONObject? = null,
    val footerHash: String? = null,
    val empty: VirtualNode? = null,
    val emptyHash: String? = null,
    val separator: VirtualNode? = null,
    val separatorHash: String? = null,
  )

  internal sealed class VirtualNode {
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

  private data class CachedLayout(
    val frames: Map<Int, Rect>,
    val structure: ViewStructure,
    val nodeCount: Int,
  )

  private data class BuildResult(
    val view: View,
    val structure: ViewStructure,
  )

  private sealed class ViewStructure(open val yogaNodeId: Int, open val style: Style?) {
    data class Container(
      override val yogaNodeId: Int,
      val children: List<ViewStructure>,
      override val style: Style?,
    ) : ViewStructure(yogaNodeId, style)

    data class Leaf(
      override val yogaNodeId: Int,
      override val style: Style?,
    ) : ViewStructure(yogaNodeId, style)
  }

  private class CacheStats {
    var hits: Int = 0
      private set
    var misses: Int = 0
      private set
    var evictions: Int = 0
      private set
    var manualInvalidations: Int = 0
      private set
    var samples: Int = 0
      private set
    var totalNodeCount: Int = 0
      private set

    fun recordHit() {
      hits++
    }

    fun recordMiss() {
      misses++
    }

    fun recordInsert(nodeCount: Int) {
      samples++
      totalNodeCount += nodeCount
    }

    fun recordEviction() {
      evictions++
    }

    fun recordManualInvalidation() {
      manualInvalidations++
    }

    fun averageNodeCount(): Int = if (samples == 0) 0 else totalNodeCount / samples
  }

  private fun maybeLogCacheStats(reason: String) {
    if (!isDebugLoggingEnabled()) return
    Log.d(
      LOG_TAG,
      "[VirtualListCache][$reason] hits=${cacheStats.hits} misses=${cacheStats.misses} " +
        "evictions=${cacheStats.evictions} invalidations=${cacheStats.manualInvalidations} " +
        "avgNodes=${cacheStats.averageNodeCount()} size=${yogaLayoutCache.size()} max=$MAX_CACHE_NODE_COUNT",
    )
  }

  private fun getParsedStyle(styleJson: String?): Style? {
    if (styleJson.isNullOrBlank()) return null
    styleCache.get(styleJson)?.let { return it }
    val parsed = runCatching { Style.fromJson(styleJson) }.getOrNull() ?: return null
    styleCache.put(styleJson, parsed)
    return parsed
  }

  private fun isYogaLayoutEnabled(): Boolean = yogaLayoutEnabled

  private fun isDebugLoggingEnabled(): Boolean = debugLoggingEnabled

  private fun incrementStructureUsage(hash: String) {
    val next = (structureUsageCounts[hash] ?: 0) + 1
    structureUsageCounts[hash] = next
  }

  private fun decrementStructureUsage(hash: String) {
    val current = structureUsageCounts[hash] ?: return
    if (current <= 1) {
      structureUsageCounts.remove(hash)
      yogaLayoutCache.remove(hash)
      cacheStats.recordManualInvalidation()
      maybeLogCacheStats("structure-invalidated:$hash")
    } else {
      structureUsageCounts[hash] = current - 1
    }
  }

  private fun invalidateAllCaches(reason: String) {
    structureUsageCounts.clear()
    structureHashByKey.clear()
    decoratorHashes.clear()
    yogaLayoutCache.evictAll()
    styleCache.evictAll()
    cacheStats.recordManualInvalidation()
    maybeLogCacheStats("full-reset:$reason")
  }

  private fun updateStructureUsage(newData: List<VirtualItem>) {
    val previousHashes = HashMap(structureHashByKey)
    val nextHashes = mutableMapOf<String, String>()

    for (item in newData) {
      val newHash = item.structureHash
      val oldHash = previousHashes.remove(item.key)
      if (oldHash != null && oldHash != newHash) {
        decrementStructureUsage(oldHash)
      }
      if (newHash != null) {
        if (oldHash == null || oldHash != newHash) {
          incrementStructureUsage(newHash)
        }
        nextHashes[item.key] = newHash
      }
    }

    for (remaining in previousHashes.values) {
      decrementStructureUsage(remaining)
    }

    structureHashByKey.clear()
    structureHashByKey.putAll(nextHashes)
  }

  private fun updateDecoratorUsage(key: String, newHash: String?) {
    val oldHash = decoratorHashes[key]
    if (oldHash != null && oldHash != newHash) {
      decrementStructureUsage(oldHash)
    }
    if (newHash != null) {
      if (oldHash == null || oldHash != newHash) {
        incrementStructureUsage(newHash)
      }
      decoratorHashes[key] = newHash
    } else {
      decoratorHashes.remove(key)
    }
  }

  // View type constants for RecyclerView adapter
  private companion object {
    const val VIEW_TYPE_HEADER = 0
    const val VIEW_TYPE_FOOTER = 1
    const val VIEW_TYPE_EMPTY = 2
    const val VIEW_TYPE_DATA = 3
    const val VIEW_TYPE_SEPARATOR = 4
    const val MAX_CACHE_NODE_COUNT = 400
    const val STYLE_CACHE_SIZE = 128
    const val LOG_TAG = "RuneVirtualList"
    const val YOGA_LOG_TAG = "RuneVirtualList_Yoga"
    @Volatile
    private var yogaLayoutEnabled: Boolean = true
    @Volatile
    private var debugLoggingEnabled: Boolean = false

    @JvmStatic
    fun setYogaLayoutEnabled(enabled: Boolean) {
      yogaLayoutEnabled = enabled
    }

    @JvmStatic
    fun setVirtualListDebugLoggingEnabled(enabled: Boolean) {
      debugLoggingEnabled = enabled
    }
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
        VIEW_TYPE_HEADER -> {
          Log.d(YOGA_LOG_TAG, "Binding HEADER at position $position")
          holder.bind(
            VirtualItem("__header", decorators.header, decorators.headerHash),
            decorators.headerStyle,
          )
        }
        VIEW_TYPE_FOOTER -> {
          Log.d(YOGA_LOG_TAG, "Binding FOOTER at position $position")
          holder.bind(
            VirtualItem("__footer", decorators.footer, decorators.footerHash),
            decorators.footerStyle,
          )
        }
        VIEW_TYPE_EMPTY -> {
          Log.d(YOGA_LOG_TAG, "Binding EMPTY at position $position")
          holder.bind(
            VirtualItem("__empty", decorators.empty, decorators.emptyHash),
            null,
          )
        }
        VIEW_TYPE_SEPARATOR -> {
          Log.d(YOGA_LOG_TAG, "Binding SEPARATOR at position $position")
          holder.bind(
            VirtualItem("__separator", decorators.separator, decorators.separatorHash),
            null,
          )
        }
        VIEW_TYPE_DATA -> {
          val dataIndex = getDataIndexFromPosition(position)
          if (dataIndex in dataItems.indices) {
            Log.d(YOGA_LOG_TAG, "Binding DATA at position $position (dataIndex=$dataIndex)")
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

      updateStructureUsage(dataList)
      
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

      updateDecoratorUsage("header", newDecorators.headerHash)
      updateDecoratorUsage("footer", newDecorators.footerHash)
      updateDecoratorUsage("empty", newDecorators.emptyHash)
      updateDecoratorUsage("separator", newDecorators.separatorHash)
      
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
      val headerHash = header?.computeStructureHash()
      
      val footer = json.optJSONObject("footer")?.let { obj ->
        parseNode(obj.optJSONObject("tree"))
      }
      val footerStyle = json.optJSONObject("footer")?.optJSONObject("style")
      val footerHash = footer?.computeStructureHash()
      
      val empty = json.optJSONObject("empty")?.let { obj ->
        parseNode(obj.optJSONObject("tree"))
      }
      val emptyHash = empty?.computeStructureHash()
      
      val separator = json.optJSONObject("separator")?.let { obj ->
        parseNode(obj.optJSONObject("tree"))
      }
      val separatorHash = separator?.computeStructureHash()
      
      return DecoratorSet(
        header = header,
        headerStyle = headerStyle,
        headerHash = headerHash,
        footer = footer,
        footerStyle = footerStyle,
        footerHash = footerHash,
        empty = empty,
        emptyHash = emptyHash,
        separator = separator,
        separatorHash = separatorHash,
      )
    }

    inner class VirtualViewHolder(
      private val container: FrameLayout,
      val viewType: Int
    ) : RecyclerView.ViewHolder(container) {

      fun bind(item: VirtualItem, styleOverride: JSONObject? = null) {
        container.removeAllViews()
        val node = item.node ?: return
        val child = createView(container.context, node, container, item.structureHash)
        
        // Apply style override for header/footer (use manual for JSONObject overrides)
        if (styleOverride != null && child is ViewGroup) {
          applyStyleManual(child, styleOverride)
        }
        
        container.addView(child)
      }
    }
  }

  private fun createView(
    context: Context,
    node: VirtualNode,
    parent: ViewGroup,
    structureHashOverride: String? = null,
  ): View {
    val engine = layoutEngine
    if (engine == null || !isYogaLayoutEnabled()) {
      Log.d(YOGA_LOG_TAG, "createView: Using manual layout (engine=${engine != null}, enabled=${isYogaLayoutEnabled()})")
      return createViewManual(context, node, parent)
    }

    val structureHash = structureHashOverride ?: node.computeStructureHash()
    val cachedLayout = structureHash?.let { yogaLayoutCache.get(it) }
    if (cachedLayout != null && cachedLayout.frames.isNotEmpty()) {
      cacheStats.recordHit()
      maybeLogCacheStats("hit:$structureHash")
      Log.d(YOGA_LOG_TAG, "createView: CACHE HIT - hash=$structureHash, frames=${cachedLayout.frames.size}")
      val cachedView = buildCachedViewTree(context, node)
      applyFramesFromStructure(
        cachedView,
        cachedLayout.structure,
        cachedLayout.frames,
        parent,
        isRoot = true,
      )
      return cachedView
    } else if (structureHash != null) {
      cacheStats.recordMiss()
      maybeLogCacheStats("miss:$structureHash")
      Log.d(YOGA_LOG_TAG, "createView: CACHE MISS - hash=$structureHash, computing layout...")
    }

    val yogaNodeIds = mutableListOf<Int>()
    val rootYogaId = getNextYogaNodeId()
    val (view, structure) = buildYogaTree(context, node, rootYogaId, engine, yogaNodeIds)

    val parentWidth = when {
      parent.width > 0 -> parent.width
      parent.measuredWidth > 0 -> parent.measuredWidth
      else -> {
        val recyclerView = generateSequence(parent as View) { it.parent as? View }
          .firstOrNull { it is RecyclerView }
        recyclerView?.width?.takeIf { it > 0 } ?: 1080
      }
    }
    
    Log.d(YOGA_LOG_TAG, "createView: parentWidth=$parentWidth, hasExplicitWidth=${hasExplicitWidth(structure.style)}")

    val frames = try {
      // Force root node to use RecyclerView width so items default to 100% width like FlatList
      // This happens BEFORE calculateLayout, ensuring Yoga uses the constraint
      if (!hasExplicitWidth(structure.style)) {
        Log.d(YOGA_LOG_TAG, "createView: Setting root width to $parentWidth (no explicit width)")
        engine.setStyle(rootYogaId, (structure.style ?: Style()).copy(
          width = parentWidth.toFloat()
        ))
      }
      
      // CRITICAL FIX: Calculate layout on THIS tree's root, not the global root
      // VirtualList items are isolated trees not connected to the global root node
      Log.d(YOGA_LOG_TAG, "createView: Calling calculateLayout on rootYogaId=$rootYogaId with width=$parentWidth")
      engine.calculateLayoutForNode(rootYogaId, parentWidth, Int.MAX_VALUE)
      
      val computedFrames = captureFrames(engine, yogaNodeIds)
      Log.d(YOGA_LOG_TAG, "createView: Calculated ${computedFrames.size} frames")
      applyFramesFromStructure(view, structure, computedFrames, parent, isRoot = true)
      computedFrames
    } finally {
      cleanupYogaNodes(engine, yogaNodeIds)
    }

    if (!structureHash.isNullOrEmpty() && frames.isNotEmpty()) {
      val nodeCount = structure.countNodes()
      yogaLayoutCache.put(structureHash, CachedLayout(frames, structure, nodeCount))
      cacheStats.recordInsert(nodeCount)
      maybeLogCacheStats("store:$structureHash")
    }

    return view
  }

  private fun buildCachedViewTree(context: Context, node: VirtualNode): View {
    return when (node) {
      is VirtualNode.ViewNode -> {
        val layout = FrameLayout(context).apply {
          clipChildren = false
          clipToPadding = false
        }
        node.testId?.let { layout.tag = it }
        node.accessibilityLabel?.let { layout.contentDescription = it }
        val style = getParsedStyle(node.styleJson) ?: Style()
        applyVisualStyle(layout, style)
        for (child in node.children) {
          val childView = buildCachedViewTree(context, child)
          layout.addView(childView)
        }
        Log.d(YOGA_LOG_TAG, "buildCachedViewTree: ViewNode with ${node.children.size} children")
        layout
      }
      is VirtualNode.TextNode -> {
        val textView = TextView(context).apply {
          text = node.text
        }
        node.numberOfLines?.let {
          textView.maxLines = it
          textView.ellipsize = TextUtils.TruncateAt.END
        }
        val style = getParsedStyle(node.styleJson) ?: Style()
        applyTextStyle(textView, style)
        applyVisualStyle(textView, style)
        Log.d(YOGA_LOG_TAG, "buildCachedViewTree: TextNode text='${node.text}' fontSize=${style.fontSize}")
        textView
      }
    }
  }

  private fun buildYogaTree(
    context: Context,
    node: VirtualNode,
    yogaId: Int,
    engine: LayoutEngine,
    yogaNodeIds: MutableList<Int>
  ): BuildResult {
    engine.createNode(yogaId)
    yogaNodeIds.add(yogaId)
    
    return when (node) {
      is VirtualNode.ViewNode -> {
        val layout = FrameLayout(context).apply {
          clipChildren = false
          clipToPadding = false
          id = yogaId
        }
        
        node.testId?.let { layout.tag = it }
        node.accessibilityLabel?.let { layout.contentDescription = it }
        
        // Parse and apply style via Yoga
        val style = getParsedStyle(node.styleJson) ?: Style()
        engine.setStyle(yogaId, style)
        
        val childStructures = mutableListOf<ViewStructure>()
        for ((index, child) in node.children.withIndex()) {
          val childYogaId = getNextYogaNodeId()
          val childResult = buildYogaTree(context, child, childYogaId, engine, yogaNodeIds)
          engine.insertChild(yogaId, childYogaId, index)
          layout.addView(childResult.view)
          childStructures.add(childResult.structure)
        }
        
        // Apply visual styles (non-layout)
        applyVisualStyle(layout, style)
        
        BuildResult(layout, ViewStructure.Container(yogaId, childStructures.toList(), style))
      }
      is VirtualNode.TextNode -> {
        val textView = TextView(context).apply {
          text = node.text
          id = yogaId
        }
        
        node.numberOfLines?.let {
          textView.maxLines = it
          textView.ellipsize = TextUtils.TruncateAt.END
        }
        
        val style = getParsedStyle(node.styleJson) ?: Style()
        
        // CRITICAL: Register measure function BEFORE setStyle so Yoga knows TextView's intrinsic size
        engine.setMeasureHandler(yogaId) { input ->
          Log.d(YOGA_LOG_TAG, "TextNode MEASURE: yogaId=$yogaId, text='${node.text}', " +
            "width=${input.width} mode=${input.widthMode}, height=${input.height} mode=${input.heightMode}")
          
          // Apply text styles first to measure accurately
          applyTextStyle(textView, style)
          
          // Convert Yoga measure modes to Android MeasureSpecs
          val widthMeasureSpec = when (input.widthMode) {
            com.rune.kit.layout.MeasureMode.UNDEFINED -> 
              View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
            com.rune.kit.layout.MeasureMode.EXACTLY -> 
              View.MeasureSpec.makeMeasureSpec(input.width.toInt(), View.MeasureSpec.EXACTLY)
            com.rune.kit.layout.MeasureMode.AT_MOST -> 
              View.MeasureSpec.makeMeasureSpec(input.width.toInt(), View.MeasureSpec.AT_MOST)
          }
          
          val heightMeasureSpec = when (input.heightMode) {
            com.rune.kit.layout.MeasureMode.UNDEFINED -> 
              View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
            com.rune.kit.layout.MeasureMode.EXACTLY -> 
              View.MeasureSpec.makeMeasureSpec(input.height.toInt(), View.MeasureSpec.EXACTLY)
            com.rune.kit.layout.MeasureMode.AT_MOST -> 
              View.MeasureSpec.makeMeasureSpec(input.height.toInt(), View.MeasureSpec.AT_MOST)
          }
          
          // Measure the TextView with constraints
          textView.measure(widthMeasureSpec, heightMeasureSpec)
          
          val measuredW = textView.measuredWidth.toFloat()
          val measuredH = textView.measuredHeight.toFloat()
          
          Log.d(YOGA_LOG_TAG, "TextNode MEASURED: yogaId=$yogaId, result=${measuredW}x${measuredH}")
          
          // Return measured size to Yoga
          Pair(measuredW, measuredH)
        }
        
        engine.setStyle(yogaId, style)
        
        // Apply text-specific and visual styles
        applyTextStyle(textView, style)
        applyVisualStyle(textView, style)
        
        BuildResult(textView, ViewStructure.Leaf(yogaId, style))
      }
    }
  }

  private fun applyFramesFromStructure(
    view: View,
    structure: ViewStructure,
    frames: Map<Int, Rect>,
    parent: ViewGroup?,
    isRoot: Boolean,
  ) {
    val frame = frames[structure.yogaNodeId] ?: return
    val width = frame.right - frame.left
    val height = frame.bottom - frame.top
    
    val viewType = when (view) {
      is TextView -> "TextView('${view.text}')"
      is ViewGroup -> "ViewGroup(${view.childCount} children)"
      else -> view::class.simpleName
    }
    
    Log.d(YOGA_LOG_TAG, "applyFrames: yogaId=${structure.yogaNodeId} $viewType frame=[$width x $height] at (${frame.left}, ${frame.top}) isRoot=$isRoot")

    // Always use Yoga's calculated dimensions - don't override with MATCH_PARENT
    val resolvedWidth = if (width > 0) width else ViewGroup.LayoutParams.WRAP_CONTENT
    val resolvedHeight = if (height > 0) height else ViewGroup.LayoutParams.WRAP_CONTENT
    val params = when (parent) {
      is FrameLayout -> FrameLayout.LayoutParams(
        resolvedWidth,
        resolvedHeight,
      ).apply {
        gravity = Gravity.TOP or Gravity.START
      }
      is LinearLayout -> LinearLayout.LayoutParams(resolvedWidth, resolvedHeight)
      is ViewGroup -> ViewGroup.LayoutParams(resolvedWidth, resolvedHeight)
      else -> ViewGroup.LayoutParams(resolvedWidth, resolvedHeight)
    }

    if (params is FrameLayout.LayoutParams && isRoot) {
      val margins = resolveMargins(structure.style)
      params.leftMargin = margins.left
      params.topMargin = margins.top
      params.rightMargin = margins.right
      params.bottomMargin = margins.bottom
    } else if (params is ViewGroup.MarginLayoutParams && isRoot) {
      val margins = resolveMargins(structure.style)
      params.setMargins(margins.left, margins.top, margins.right, margins.bottom)
    } else if (params is ViewGroup.MarginLayoutParams) {
      params.setMargins(0, 0, 0, 0)
    }

    view.layoutParams = params

    if (view is ViewGroup && structure is ViewStructure.Container) {
      val childCount = minOf(view.childCount, structure.children.size)
      for (i in 0 until childCount) {
        val child = view.getChildAt(i)
        val childStructure = structure.children[i]
        applyFramesFromStructure(child, childStructure, frames, view, false)
      }
    }

    if (isRoot) {
      view.translationX = 0f
      view.translationY = 0f
    } else {
      view.translationX = frame.left.toFloat()
      view.translationY = frame.top.toFloat()
    }
  }

  private fun captureFrames(engine: LayoutEngine, yogaNodeIds: List<Int>): Map<Int, Rect> {
    if (yogaNodeIds.isEmpty()) return emptyMap()
    val allFrames = engine.getAllFrames()
    if (allFrames.isEmpty()) return emptyMap()
    
    Log.d(YOGA_LOG_TAG, "captureFrames: Looking for ${yogaNodeIds.size} nodes: $yogaNodeIds")
    Log.d(YOGA_LOG_TAG, "captureFrames: getAllFrames returned ${allFrames.size} frames with keys: ${allFrames.keys}")
    
    val frames = HashMap<Int, Rect>(yogaNodeIds.size)
    for (id in yogaNodeIds) {
      val frame = allFrames[id]
      if (frame != null) {
        frames[id] = frame
        Log.d(YOGA_LOG_TAG, "captureFrames: Found frame for id=$id: $frame")
      } else {
        Log.w(YOGA_LOG_TAG, "captureFrames: MISSING frame for id=$id!")
      }
    }
    
    Log.d(YOGA_LOG_TAG, "captureFrames: Captured ${frames.size} frames successfully")
    return frames
  }

  private fun cleanupYogaNodes(engine: LayoutEngine, yogaNodeIds: List<Int>) {
    for (id in yogaNodeIds.asReversed()) {
      runCatching { engine.removeNode(id) }
    }
  }

  private fun ViewStructure.countNodes(): Int = when (this) {
    is ViewStructure.Container -> 1 + children.sumOf { it.countNodes() }
    is ViewStructure.Leaf -> 1
  }

  private data class ResolvedMargins(val left: Int, val top: Int, val right: Int, val bottom: Int)

  private fun resolveMargins(style: Style?): ResolvedMargins {
    if (style == null) return ResolvedMargins(0, 0, 0, 0)

    fun resolve(value: Float?, axisFallback: Float?, fallback: Float?): Int {
      val raw = value ?: axisFallback ?: fallback ?: 0f
      return dpToPx(raw.toDouble())
    }

    val all = style.margin
    val left = resolve(style.marginLeft, null, all)
    val right = resolve(style.marginRight, null, all)
    val top = resolve(style.marginTop, null, all)
    val bottom = resolve(style.marginBottom, null, all)
    return ResolvedMargins(left, top, right, bottom)
  }

  private fun hasExplicitWidth(style: Style?): Boolean {
    if (style == null) return false
    if (style.width != null) return true
    if (style.widthPercent != null) return true
    if (style.widthAuto) return true
    return false
  }

internal fun VirtualNode.computeStructureHash(): String = when (this) {
    is VirtualNode.ViewNode -> {
      val styleHash = styleJson?.let { hashStyleProperties(it) } ?: "0"
      val childHash = if (children.isEmpty()) {
        ""
      } else {
        children.joinToString(separator = ",") { it.computeStructureHash() }
      }
      "view|$styleHash|$childHash"
    }
    is VirtualNode.TextNode -> {
      val styleHash = styleJson?.let { hashStyleProperties(it) } ?: "0"
      val lines = numberOfLines ?: -1
      "text|$styleHash|$lines"
    }
  }

  internal fun hashStyleProperties(styleJson: String): String {
    val style = getParsedStyle(styleJson) ?: return "0"
    val signature = arrayOf(
      style.width,
      style.height,
      style.widthPercent,
      style.heightPercent,
      style.widthAuto,
      style.heightAuto,
      style.minWidth,
      style.maxWidth,
      style.minHeight,
      style.maxHeight,
      style.flex,
      style.flexGrow,
      style.flexShrink,
      style.flexDirection,
      style.justifyContent,
      style.alignItems,
      style.alignSelf,
      style.padding,
      style.paddingHorizontal,
      style.paddingVertical,
      style.paddingLeft,
      style.paddingRight,
      style.paddingTop,
      style.paddingBottom,
      style.margin,
      style.marginLeft,
      style.marginRight,
      style.marginTop,
      style.marginBottom,
      style.gap,
      style.rowGap,
      style.columnGap,
      style.borderWidth,
    )
    return signature.contentDeepHashCode().toString()
  }

  @VisibleForTesting
  internal fun renderNodeForTesting(node: VirtualNode): View {
    val parent = FrameLayout(context)
    parent.layoutParams = LayoutParams(
      LayoutParams.MATCH_PARENT,
      LayoutParams.WRAP_CONTENT,
    )
    return createView(context, node, parent)
  }

  @VisibleForTesting
  internal fun clearCachesForTesting() {
    invalidateAllCaches("test")
  }

  // Fallback for when LayoutEngine is not available
  private fun createViewManual(context: Context, node: VirtualNode, parent: ViewGroup): View {
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
        applyStyleManual(layout, style)
        for (child in node.children) {
          val view = createViewManual(context, child, layout)
          layout.addView(view)
        }
        applyLayoutParamsManual(layout, style, parent)
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
        applyTextStyleManual(textView, style)
        applyLayoutParamsManual(textView, style, parent)
        textView
      }
    }
  }

  private fun applyVisualStyle(view: View, style: Style) {
    // Apply background color and border radius
    style.backgroundColor?.let { color ->
      if (style.borderRadius != null && style.borderRadius > 0) {
        val drawable = GradientDrawable().apply {
          setColor(color)
          cornerRadius = dpToPxF(style.borderRadius.toDouble())
        }
        
        // Apply border if specified
        style.borderWidth?.let { width ->
          style.borderColor?.let { borderColor ->
            drawable.setStroke(dpToPx(width.toDouble()), borderColor)
          }
        }
        
        view.background = drawable
      } else {
        view.setBackgroundColor(color)
      }
    }

    // Apply padding (Yoga calculates layout, but Android padding is visual)
    val paddingLeft = (style.paddingLeft ?: style.paddingHorizontal ?: style.padding)?.let { dpToPx(it.toDouble()) } ?: 0
    val paddingTop = (style.paddingTop ?: style.paddingVertical ?: style.padding)?.let { dpToPx(it.toDouble()) } ?: 0
    val paddingRight = (style.paddingRight ?: style.paddingHorizontal ?: style.padding)?.let { dpToPx(it.toDouble()) } ?: 0
    val paddingBottom = (style.paddingBottom ?: style.paddingVertical ?: style.padding)?.let { dpToPx(it.toDouble()) } ?: 0
    
    if (paddingLeft > 0 || paddingTop > 0 || paddingRight > 0 || paddingBottom > 0) {
      view.setPadding(paddingLeft, paddingTop, paddingRight, paddingBottom)
    }
  }

  private fun applyTextStyle(textView: TextView, style: Style) {
    style.fontSize?.let {
      textView.setTextSize(TypedValue.COMPLEX_UNIT_DIP, it)
    }
    
    style.color?.let {
      textView.setTextColor(it)
    }
    
    style.fontWeight?.let { weight ->
      textView.paint.isFakeBoldText = weight.equals("bold", ignoreCase = true) ||
        weight.toIntOrNull()?.let { value -> value >= 600 } == true
    }
  }

  // Manual fallback methods (keep old implementation for compatibility)
  private fun applyLayoutParamsManual(view: View, style: JSONObject?, parent: ViewGroup) {
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

  private fun applyStyleManual(view: View, style: JSONObject?) {
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

  private fun applyTextStyleManual(textView: TextView, style: JSONObject?) {
    if (style == null) return
    applyStyleManual(textView, style)

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
