package com.rune.components.text

import android.graphics.Typeface
import android.util.Log
import android.util.TypedValue
import android.view.View
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.core.RuneUIManager
import com.rune.kit.layout.MeasureMode
import com.rune.kit.layout.Style
import kotlin.math.roundToInt

/**
 * Helper function to parse JSON string values
 */
private fun parseString(json: String?): String? {
  if (json == null || json == "null") return null
  if (json.length >= 2 && json.startsWith("\"") && json.endsWith("\"")) {
    return json.substring(1, json.length - 1)
  }
  return json
}

/**
 * Creates and returns the Text component descriptor.
 */
fun createTextComponentDescriptor(): RuneComponentDescriptor {
  return RuneComponentDescriptor(
    type = "text",
    createView = { context, _ -> RuneTextView(context) },
    onNodeCreated = { manager, node ->
      val textView = node.view as? TextView ?: return@RuneComponentDescriptor
      
      // Set up measurement handler for text
      manager.getLayoutEngine().setMeasureHandler(node.id) { input ->
        val widthValue = when {
          input.width.isNaN() -> 0
          input.width.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.width.roundToInt()
        }
        val heightValue = when {
          input.height.isNaN() -> 0
          input.height.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.height.roundToInt()
        }
        
        val widthSpec = when (input.widthMode) {
          MeasureMode.EXACTLY -> MeasureSpec.makeMeasureSpec(widthValue, MeasureSpec.EXACTLY)
          MeasureMode.AT_MOST -> MeasureSpec.makeMeasureSpec(widthValue, MeasureSpec.AT_MOST)
          MeasureMode.UNDEFINED -> MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
        }
        val heightSpec = when (input.heightMode) {
          MeasureMode.EXACTLY -> MeasureSpec.makeMeasureSpec(heightValue, MeasureSpec.EXACTLY)
          MeasureMode.AT_MOST -> MeasureSpec.makeMeasureSpec(heightValue, MeasureSpec.AT_MOST)
          MeasureMode.UNDEFINED -> MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
        }
        
        textView.measure(widthSpec, heightSpec)
        val measuredWidth = textView.measuredWidth.coerceAtLeast(1)
        val measuredHeight = textView.measuredHeight.coerceAtLeast((textView.textSize * 1.2f).roundToInt())
        measuredWidth.toFloat() to measuredHeight.toFloat()
      }
      
      // Set appropriate layout params
      node.view.layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      )
    },
    applyProperty = { node, name, jsonValue ->
      val textView = node.view as? TextView
      if (textView == null) {
        false
      } else {
        when (name) {
          "text" -> {
            val text = parseString(jsonValue) ?: ""
            node.cachedText = text
            // Text will be set during style application or setText
            true
          }
          "numberOfLines" -> {
            val lines = jsonValue?.toIntOrNull() ?: 0
            textView.maxLines = if (lines > 0) lines else Int.MAX_VALUE
            true
          }
          else -> false
        }
      }
    },
    onStyleApplied = { node, style ->
      val textView = node.view as? TextView ?: return@RuneComponentDescriptor
      
      // Apply text-specific styling
      style.fontSize?.let { fontSize ->
        textView.setTextSize(TypedValue.COMPLEX_UNIT_PX, fontSize)
      }
      
      style.color?.let { color ->
        textView.setTextColor(color)
      }
      
      style.fontWeight?.let { weight ->
        val isBold = weight.equals("bold", ignoreCase = true) ||
          weight.toIntOrNull()?.let { it >= 600 } == true
        textView.setTypeface(textView.typeface, if (isBold) Typeface.BOLD else Typeface.NORMAL)
      }
    },
    onSetHandler = { node, event ->
      // Text doesn't handle any specific events
      false
    },
    onReset = { node ->
      val textView = node.view as? TextView ?: return@RuneComponentDescriptor
      textView.text = ""
      node.cachedText = ""
      node.textChildren.clear()
    }
  )
}

/**
 * Registrar that registers the Text component with the RuneComponentRegistry.
 * Automatically discovered via ServiceLoader.
 */
class TextComponentRegistrar : RuneComponentRegistrar {
  override fun register(registry: com.rune.kit.components.RuneComponentRegistry) {
    val descriptor = createTextComponentDescriptor()
    registry.register(descriptor)
    Log.d("RuneComponents", "Registered Text component")
  }
}
