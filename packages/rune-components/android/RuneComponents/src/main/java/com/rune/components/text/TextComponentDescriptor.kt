package com.rune.components.text

import android.graphics.Typeface
import android.util.Log
import android.os.SystemClock
import android.util.TypedValue
import android.view.View
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.core.RuneUIManager
import com.rune.kit.core.TextStyleAttributes
import com.rune.kit.runtime.FontRegistry
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
      val measureTag = "RuneText/measure"
      manager.getLayoutEngine().setMeasureHandler(node.id) { input ->
        val measureStart = SystemClock.elapsedRealtimeNanos()
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
        val durationMs = (SystemClock.elapsedRealtimeNanos() - measureStart) / 1_000_000.0
        if (durationMs > 8) {
          Log.w(
            measureTag,
            "Slow text measure: node=${node.id} text='${node.cachedText.take(24)}' duration=${"%.2f".format(durationMs)}ms",
          )
        }
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
            val startNs = SystemClock.elapsedRealtimeNanos()
            val text = parseString(jsonValue) ?: ""
            node.cachedText = text
            // Text will be set during style application or setText
            val durationMs = (SystemClock.elapsedRealtimeNanos() - startNs) / 1_000_000.0
            if (durationMs > 4) {
              Log.w(
                "RuneText/setProp",
                "Slow text prop: node=${node.id} duration=${"%.2f".format(durationMs)}ms",
              )
            }
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
      val styleStart = SystemClock.elapsedRealtimeNanos()

      // Always capture text style attributes for composition (even for virtual text nodes)
      node.textStyle = TextStyleAttributes.fromStyle(style)

      // Apply text-specific styling to TextView (only for non-virtual text nodes)
      val textView = node.view as? TextView
      if (textView != null) {
        style.fontSize?.let { fontSize ->
          textView.setTextSize(TypedValue.COMPLEX_UNIT_PX, fontSize)
        }
        
        style.color?.let { color ->
          textView.setTextColor(color)
        }
        
        val weight = style.fontWeight
        val isBold = weight?.let {
          it.equals("bold", ignoreCase = true) || it.toIntOrNull()?.let { w -> w >= 600 } == true
        } ?: false
        val styleInt = if (isBold) Typeface.BOLD else Typeface.NORMAL

        val family = style.fontFamily
        val baseTypeface = if (family != null) {
          FontRegistry.getTypeface(family) ?: Typeface.create(family, styleInt)
        } else {
          Typeface.DEFAULT
        }
        
        if (baseTypeface != null) {
          textView.setTypeface(Typeface.create(baseTypeface, styleInt))
        } else {
          textView.setTypeface(Typeface.DEFAULT, styleInt)
        }
      }

      val durationMs = (SystemClock.elapsedRealtimeNanos() - styleStart) / 1_000_000.0
      if (durationMs > 4) {
        Log.w(
          "RuneText/style",
          "Slow text style: node=${node.id} duration=${"%.2f".format(durationMs)}ms",
        )
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
      node.textStyle = null
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
