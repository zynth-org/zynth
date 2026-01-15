package com.zynth.components.textinput

import android.content.Context
import android.graphics.Typeface
import android.util.TypedValue
import android.view.View.MeasureSpec
import android.widget.FrameLayout
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry
import com.zynth.kit.core.ZynthUIManager
import com.zynth.kit.layout.MeasureMode
import com.zynth.kit.layout.Style
import com.zynth.kit.runtime.FontRegistry
import org.json.JSONObject
import kotlin.math.roundToInt

class TextInputComponentRegistrar : ZynthComponentRegistrar {
  private fun applyStyle(input: ZynthTextInputView, style: Style) {
    val left = (style.paddingLeft ?: style.paddingHorizontal ?: style.padding ?: 0f).toInt()
    val right = (style.paddingRight ?: style.paddingHorizontal ?: style.padding ?: 0f).toInt()
    val top = (style.paddingTop ?: style.paddingVertical ?: style.padding ?: 0f).toInt()
    val bottom = (style.paddingBottom ?: style.paddingVertical ?: style.padding ?: 0f).toInt()

    val currentPadding = input.getStyledPadding()
    if (currentPadding.left != left || currentPadding.right != right ||
      currentPadding.top != top || currentPadding.bottom != bottom
    ) {
      input.updateStylePadding(left, top, right, bottom)
    }

    style.fontSize?.let { fontSize ->
      input.setTextSize(TypedValue.COMPLEX_UNIT_PX, fontSize)
    }

    style.color?.let { color ->
      input.setTextColor(color)
    }

    val weight = style.fontWeight
    val isBold = weight?.let {
      it.equals("bold", ignoreCase = true) || it.toIntOrNull()?.let { w -> w >= 600 } == true
    } ?: false
    val isItalic = style.fontStyle?.equals("italic", ignoreCase = true) == true
    val styleInt = when {
      isBold && isItalic -> Typeface.BOLD_ITALIC
      isBold -> Typeface.BOLD
      isItalic -> Typeface.ITALIC
      else -> Typeface.NORMAL
    }

    val family = style.fontFamily
    val baseTypeface = if (family != null) {
      FontRegistry.getTypeface(family) ?: Typeface.create(family, styleInt)
    } else {
      Typeface.DEFAULT
    }

    input.setTypeface(Typeface.create(baseTypeface, styleInt))
  }

  private fun registerMeasureHandler(
    manager: ZynthUIManager,
    node: ZynthUIManager.Node,
    input: ZynthTextInputView,
  ) {
    fun resolveDimension(value: Float): Int {
      if (value.isNaN()) return 0
      if (value.isInfinite()) return Int.MAX_VALUE / 2
      return value.roundToInt().coerceAtLeast(0)
    }

    fun toMeasureSpec(mode: MeasureMode, value: Int): Int {
      return when (mode) {
        MeasureMode.EXACTLY -> MeasureSpec.makeMeasureSpec(value, MeasureSpec.EXACTLY)
        MeasureMode.AT_MOST -> MeasureSpec.makeMeasureSpec(value, MeasureSpec.AT_MOST)
        MeasureMode.UNDEFINED -> MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
      }
    }

    manager.setMeasureHandler(node.id) { measureInput ->
      val widthValue = resolveDimension(measureInput.width)
      val heightValue = resolveDimension(measureInput.height)
      val widthSpec = toMeasureSpec(measureInput.widthMode, widthValue)
      val heightSpec = toMeasureSpec(measureInput.heightMode, heightValue)

      input.ensureBaselineConstraints()
      input.measure(widthSpec, heightSpec)

      val paddingWidth = input.paddingLeft + input.paddingRight
      val paddingHeight = input.paddingTop + input.paddingBottom
      val measuredWidth = input.measuredWidth.takeIf { it > 0 } ?: widthValue
      val rawMeasuredHeight = input.measuredHeight.takeIf { it > 0 }
        ?: input.lineHeight
      val measuredHeight = rawMeasuredHeight.coerceAtLeast(1)
      val contentWidth = (measuredWidth - paddingWidth).coerceAtLeast(0)
      val contentHeight = (measuredHeight - paddingHeight).coerceAtLeast(0)

      val resolvedWidth = when (measureInput.widthMode) {
        MeasureMode.EXACTLY -> widthValue
        MeasureMode.AT_MOST -> minOf(widthValue, contentWidth.coerceAtLeast(1))
        MeasureMode.UNDEFINED -> contentWidth.coerceAtLeast(1)
      }
      val resolvedHeight = when (measureInput.heightMode) {
        MeasureMode.EXACTLY -> heightValue
        MeasureMode.AT_MOST -> minOf(heightValue, contentHeight.coerceAtLeast(1))
        MeasureMode.UNDEFINED -> contentHeight.coerceAtLeast(1)
      }

      resolvedWidth.coerceAtLeast(1).toFloat() to resolvedHeight.coerceAtLeast(1).toFloat()
    }
  }

  override fun register(registry: ZynthComponentRegistry) {
    // Register text-input (multiline)
    registry.register(
      ZynthComponentDescriptor(
        type = "text-input",
        createView = { context: Context, _: Int ->
          val view = ZynthTextInputView(context)
          view.layoutParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
          )
          view
        },
        onNodeCreated = { manager: ZynthUIManager, node: ZynthUIManager.Node ->
          (node.view as? ZynthTextInputView)?.let { input ->
            node.textInputState = node.textInputState ?: ZynthUIManager.TextInputState()
            input.manager = manager
            input.nodeId = node.id
            input.clearHandlers()
            registerMeasureHandler(manager, node, input)
          }
        },
        applyProperty = { node, name, value -> TextInputPropAdapter.apply(node, name, value) },
        onStyleApplied = { node, style ->
          (node.view as? ZynthTextInputView)?.let { input ->
            applyStyle(input, style)
          }
        },
        onSetHandler = { node, event ->
          val input = node.view as? ZynthTextInputView ?: return@ZynthComponentDescriptor false
          when (event) {
            "onChange" -> {
              input.hasOnChange = true
              true
            }
            "onChangeText" -> {
              input.hasOnChangeText = true
              true
            }
            "onSelectionChange" -> {
              input.hasOnSelectionChange = true
              true
            }
            "onFocus" -> {
              input.hasOnFocus = true
              true
            }
            "onBlur" -> {
              input.hasOnBlur = true
              true
            }
            "onSubmitEditing" -> {
              input.hasOnSubmitEditing = true
              true
            }
            "onKeyPress" -> {
              input.hasOnKeyPress = true
              true
            }
            "onCompositionStart" -> {
              input.hasOnCompositionStart = true
              true
            }
            "onCompositionEnd" -> {
              input.hasOnCompositionEnd = true
              true
            }
            else -> false
          }
        },
        onReset = { node ->
          (node.view as? ZynthTextInputView)?.let {
            it.clearHandlers()
            it.performProgrammaticUpdate {
              it.setText("")
            }
          }
        },
      ),
    )

    // Register secure-text-input (single-line password field)
    registry.register(
      ZynthComponentDescriptor(
        type = "secure-text-input",
        createView = { context: Context, _: Int ->
          val view = ZynthSecureTextInputView(context)
          view.layoutParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
          )
          view
        },
        onNodeCreated = { manager: ZynthUIManager, node: ZynthUIManager.Node ->
          (node.view as? ZynthSecureTextInputView)?.let { input ->
            node.textInputState = node.textInputState ?: ZynthUIManager.TextInputState()
            input.manager = manager
            input.nodeId = node.id
            input.clearHandlers()
            registerMeasureHandler(manager, node, input)
          }
        },
        applyProperty = { node, name, value -> TextInputPropAdapter.apply(node, name, value) },
        onStyleApplied = { node, style ->
          (node.view as? ZynthSecureTextInputView)?.let { input ->
            applyStyle(input, style)
          }
        },
        onSetHandler = { node, event ->
          val input = node.view as? ZynthSecureTextInputView ?: return@ZynthComponentDescriptor false
          when (event) {
            "onChange" -> {
              input.hasOnChange = true
              true
            }
            "onChangeText" -> {
              input.hasOnChangeText = true
              true
            }
            "onFocus" -> {
              input.hasOnFocus = true
              true
            }
            "onBlur" -> {
              input.hasOnBlur = true
              true
            }
            "onSubmitEditing" -> {
              input.hasOnSubmitEditing = true
              true
            }
            else -> false
          }
        },
        onReset = { node ->
          (node.view as? ZynthSecureTextInputView)?.let {
            it.clearHandlers()
            it.performProgrammaticUpdate {
              it.setText("")
            }
          }
        },
      ),
    )
  }
}
