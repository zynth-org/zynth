package com.rune.kit.core

import android.content.Context
import android.widget.FrameLayout
import androidx.test.core.app.ApplicationProvider
import com.rune.kit.layout.LayoutEngine
import com.rune.kit.layout.MeasureHandler
import com.rune.kit.layout.Rect
import com.rune.kit.layout.Style
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import kotlin.math.max
import kotlin.math.roundToInt

@RunWith(RobolectricTestRunner::class)
class RuneVirtualListViewTest {

  private lateinit var context: Context
  private lateinit var view: RuneVirtualListView
  private lateinit var engine: RecordingLayoutEngine

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    view = RuneVirtualListView(context)
    engine = RecordingLayoutEngine()
    view.setLayoutEngine(engine)
  }

  @Test
  fun structureHashIdenticalForEquivalentTrees() {
    val nodeA = VirtualNode.ViewNode(
      styleJson = """{"width":100,"height":40}""",
      pointerEvents = null,
      accessibilityLabel = null,
      accessibilityHint = null,
      accessibilityRole = null,
      testId = null,
      children = listOf(
        VirtualNode.TextNode(text = "Hello", styleJson = null, numberOfLines = null),
      ),
    )
    val nodeB = nodeA.copy()

    assertEquals(nodeA.computeStructureHash(), nodeB.computeStructureHash())
  }

  @Test
  fun structureHashChangesWhenLayoutDiffers() {
    val base = VirtualNode.ViewNode(
      styleJson = """{"width":100,"height":40}""",
      pointerEvents = null,
      accessibilityLabel = null,
      accessibilityHint = null,
      accessibilityRole = null,
      testId = null,
      children = emptyList(),
    )
    val mutated = base.copy(styleJson = """{"width":120,"height":40}""")

    assertNotEquals(base.computeStructureHash(), mutated.computeStructureHash())
  }

  @Test
  fun cachedRenderSkipsSubsequentLayoutPasses() {
    val node = sampleItemNode()

    view.renderNodeForTesting(node)
    assertEquals(1, engine.layoutPasses)

    view.renderNodeForTesting(node)
    assertEquals(
      "Cache hit should avoid additional layout passes",
      1,
      engine.layoutPasses,
    )
  }

  @Test
  fun manualInvalidationClearsCache() {
    val node = sampleItemNode()

    view.renderNodeForTesting(node)
    assertEquals(1, engine.layoutPasses)

    view.clearCachesForTesting()
    view.renderNodeForTesting(node)
    assertEquals(2, engine.layoutPasses)
  }

  @Test
  fun flexDirectionRowPositionsChildrenHorizontally() {
    val node = VirtualNode.ViewNode(
      styleJson = """{"flexDirection":"row","gap":12,"padding":0}""",
      pointerEvents = null,
      accessibilityLabel = null,
      accessibilityHint = null,
      accessibilityRole = null,
      testId = null,
      children = listOf(
        VirtualNode.ViewNode(
          styleJson = """{"width":40,"height":40}""",
          pointerEvents = null,
          accessibilityLabel = null,
          accessibilityHint = null,
          accessibilityRole = null,
          testId = "left",
          children = emptyList(),
        ),
        VirtualNode.ViewNode(
          styleJson = """{"width":40,"height":40}""",
          pointerEvents = null,
          accessibilityLabel = null,
          accessibilityHint = null,
          accessibilityRole = null,
          testId = "right",
          children = emptyList(),
        ),
      ),
    )

    val rendered = view.renderNodeForTesting(node) as ViewGroup
    val first = rendered.getChildAt(0)
    val second = rendered.getChildAt(1)
    val firstLp = first.layoutParams as FrameLayout.LayoutParams
    val secondLp = second.layoutParams as FrameLayout.LayoutParams

    assertEquals(0, firstLp.leftMargin)
    assertTrue("Second child should be offset to the right", secondLp.leftMargin > firstLp.leftMargin)
  }

  @Test
  fun rootMarginBottomAppliesSpacing() {
    val node = VirtualNode.ViewNode(
      styleJson = """{"marginBottom":25,"height":20}""",
      pointerEvents = null,
      accessibilityLabel = null,
      accessibilityHint = null,
      accessibilityRole = null,
      testId = "root",
      children = emptyList(),
    )

    val rendered = view.renderNodeForTesting(node)
    val lp = rendered.layoutParams as FrameLayout.LayoutParams
    assertEquals(dp(25f), lp.bottomMargin)
  }

  private fun sampleItemNode(): VirtualNode.ViewNode {
    return VirtualNode.ViewNode(
      styleJson = """{"width":200,"height":60}""",
      pointerEvents = null,
      accessibilityLabel = null,
      accessibilityHint = null,
      accessibilityRole = null,
      testId = "sample",
      children = listOf(
        VirtualNode.TextNode(
          text = "Title",
          styleJson = """{"height":20}""",
          numberOfLines = 1,
        ),
        VirtualNode.TextNode(
          text = "Subtitle",
          styleJson = """{"height":20}""",
          numberOfLines = 1,
        ),
      ),
    )
  }

  private fun dp(value: Float): Int {
    val density = context.resources.displayMetrics.density
    return (value * density).roundToInt()
  }

  private class RecordingLayoutEngine : LayoutEngine {
    private val nodes = linkedSetOf<Int>()
    private val styles = mutableMapOf<Int, Style>()
    private val frames = mutableMapOf<Int, Rect>()

    var layoutPasses: Int = 0
      private set

    override fun createNode(id: Int) {
      nodes.add(id)
    }

    override fun removeNode(id: Int) {
      nodes.remove(id)
      styles.remove(id)
      frames.remove(id)
    }

    override fun insertChild(parent: Int, child: Int, index: Int) {
      // Children ordering is irrelevant for this fake engine
    }

    override fun setStyle(id: Int, style: Style) {
      styles[id] = style
    }

    override fun calculateLayout(width: Int, height: Int) {
      layoutPasses++
      var cursor = 0
      for (nodeId in nodes) {
        val style = styles[nodeId]
        val resolvedHeight = max(1f, style?.height ?: 20f).roundToInt()
        val resolvedWidth = max(1f, style?.width ?: width.toFloat()).roundToInt()
        frames[nodeId] = Rect(0, cursor, resolvedWidth, cursor + resolvedHeight)
        cursor += resolvedHeight
      }
    }

    override fun frame(id: Int): Rect = frames[id] ?: Rect(0, 0, 0, 0)

    override fun getAllFrames(): Map<Int, Rect> = HashMap(frames)

    override fun setMeasureHandler(id: Int, handler: MeasureHandler?) {
      // Not required for tests
    }

    override fun markDirty(id: Int) {
      // No-op for tests
    }

    override fun reset() {
      nodes.clear()
      styles.clear()
      frames.clear()
      layoutPasses = 0
    }
  }
}
