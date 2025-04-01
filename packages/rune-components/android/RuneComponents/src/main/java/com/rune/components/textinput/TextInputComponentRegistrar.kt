package com.rune.components.textinput

import android.content.Context
import android.widget.FrameLayout
import android.view.View.MeasureSpec
import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.components.RuneComponentRegistry
import com.rune.kit.core.RuneUIManager
import com.rune.kit.layout.MeasureMode
import com.rune.kit.layout.Style
import org.json.JSONObject
import kotlin.math.roundToInt

class TextInputComponentRegistrar : RuneComponentRegistrar {
  private fun registerMeasureHandler(
    manager: RuneUIManager,
    node: RuneUIManager.Node,
    input: RuneTextInputView,
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

      val measuredWidth = input.measuredWidth.takeIf { it > 0 } ?: widthValue
      val rawMeasuredHeight = input.measuredHeight.takeIf { it > 0 }
        ?: (input.lineHeight + input.paddingTop + input.paddingBottom)
      val measuredHeight = rawMeasuredHeight.coerceAtLeast(1)

      if (measuredHeight > 0) {
        input.setExpectedExactHeight(measuredHeight)
      }

      measuredWidth.coerceAtLeast(1).toFloat() to measuredHeight.toFloat()
    }
  }

  override fun register(registry: RuneComponentRegistry) {
    // Register text-input (multiline)
    registry.register(
      RuneComponentDescriptor(
        type = "text-input",
        createView = { context: Context, _: Int ->
          val view = RuneTextInputView(context)
          view.layoutParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
          )
          view
        },
        onNodeCreated = { manager: RuneUIManager, node: RuneUIManager.Node ->
          (node.view as? RuneTextInputView)?.let { input ->
            node.textInputState = node.textInputState ?: RuneUIManager.TextInputState()
            input.manager = manager
            input.nodeId = node.id
            input.clearHandlers()
            registerMeasureHandler(manager, node, input)
          }
        },
        applyProperty = { node, name, value -> TextInputPropAdapter.apply(node, name, value) },
        onStyleApplied = { node, style ->
          // Extract padding from style and apply it properly to avoid accumulation
          (node.view as? RuneTextInputView)?.let { input ->
            val left = (style.paddingLeft ?: style.paddingHorizontal ?: style.padding ?: 0f).toInt()
            val right = (style.paddingRight ?: style.paddingHorizontal ?: style.padding ?: 0f).toInt()
            val top = (style.paddingTop ?: style.paddingVertical ?: style.padding ?: 0f).toInt()
            val bottom = (style.paddingBottom ?: style.paddingVertical ?: style.padding ?: 0f).toInt()
            
            // Only update if padding has actually changed
            val currentPadding = input.getStyledPadding()
            if (currentPadding.left != left || currentPadding.right != right ||
                currentPadding.top != top || currentPadding.bottom != bottom) {
              input.updateStylePadding(left, top, right, bottom)
            }
          }
        },
        onSetHandler = { node, event ->
          val input = node.view as? RuneTextInputView ?: return@RuneComponentDescriptor false
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
          (node.view as? RuneTextInputView)?.let {
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
      RuneComponentDescriptor(
        type = "secure-text-input",
        createView = { context: Context, _: Int ->
          val view = RuneSecureTextInputView(context)
          view.layoutParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
          )
          view
        },
        onNodeCreated = { manager: RuneUIManager, node: RuneUIManager.Node ->
          (node.view as? RuneSecureTextInputView)?.let { input ->
            node.textInputState = node.textInputState ?: RuneUIManager.TextInputState()
            input.manager = manager
            input.nodeId = node.id
            input.clearHandlers()
            registerMeasureHandler(manager, node, input)
          }
        },
        applyProperty = { node, name, value -> TextInputPropAdapter.apply(node, name, value) },
        onStyleApplied = { node, style ->
          // Extract padding from style and apply it properly to avoid accumulation
          (node.view as? RuneSecureTextInputView)?.let { input ->
            val left = (style.paddingLeft ?: style.paddingHorizontal ?: style.padding ?: 0f).toInt()
            val right = (style.paddingRight ?: style.paddingHorizontal ?: style.padding ?: 0f).toInt()
            val top = (style.paddingTop ?: style.paddingVertical ?: style.padding ?: 0f).toInt()
            val bottom = (style.paddingBottom ?: style.paddingVertical ?: style.padding ?: 0f).toInt()
            
            // Only update if padding has actually changed
            val currentPadding = input.getStyledPadding()
            if (currentPadding.left != left || currentPadding.right != right ||
                currentPadding.top != top || currentPadding.bottom != bottom) {
              input.updateStylePadding(left, top, right, bottom)
            }
          }
        },
        onSetHandler = { node, event ->
          val input = node.view as? RuneSecureTextInputView ?: return@RuneComponentDescriptor false
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
          (node.view as? RuneSecureTextInputView)?.let {
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
