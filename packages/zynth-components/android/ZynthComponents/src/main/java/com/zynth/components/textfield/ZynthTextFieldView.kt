package com.zynth.components.textfield

import android.content.Context
import android.graphics.Color
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import kotlin.math.roundToInt

/**
 * A native Material 3 TextField for Zynth.
 *
 * Wraps TextInputLayout + TextInputEditText from Material Components,
 * using the placeholder prop as the floating label (M3 style).
 *
 * Supports:
 * - Value/text control with feedback loop prevention
 * - Placeholder as floating label
 * - Disabled/editable states
 * - Secure text entry
 * - Keyboard types
 * - Return key types
 * - Auto-capitalize and auto-correct
 * - Max length
 * - Focus/blur control
 */
class ZynthTextFieldView(context: Context) : FrameLayout(context) {

  var nodeId: Int = -1

  /** Listener for text field events */
  var listener: Listener? = null

  private val textInputLayout: TextInputLayout
  private val textInputEditText: TextInputEditText
  private val density = resources.displayMetrics.density

  private var isUpdatingFromJS = false
  private var maxLength: Int = Int.MAX_VALUE
  private var currentVariant: String = "filled"
  private var currentBackgroundColor: Int? = null
  private var currentBorderRadius: Float? = null  // null means use M3 default
  private var hasCustomBorderColor: Boolean = false
  private var currentBorderWidth: Float? = null  // null means use M3 default

  interface Listener {
    fun onChange(nodeId: Int, value: String)
    fun onFocus(nodeId: Int)
    fun onBlur(nodeId: Int)
    fun onSubmit(nodeId: Int, value: String)
  }

  companion object {
    private const val TAG = "ZynthTextFieldView"
    private const val MIN_HEIGHT_DP = 56 // Material 3 minimum height for filled text field
    private const val DEFAULT_CORNER_RADIUS_DP = 4f // Material 3 default corner radius
  }

  init {
    // Don't clip children so the floating label can animate properly
    clipChildren = false
    clipToPadding = false
    
    textInputLayout = TextInputLayout(context, null, com.google.android.material.R.attr.textInputFilledStyle).apply {
      boxBackgroundMode = TextInputLayout.BOX_BACKGROUND_FILLED
    }

    textInputEditText = TextInputEditText(textInputLayout.context).apply {
      layoutParams = android.widget.LinearLayout.LayoutParams(
        android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
        android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
      )
      setSingleLine(true)
    }

    textInputLayout.addView(textInputEditText)
    addView(textInputLayout, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))

    // Set up text change listener
    textInputEditText.addTextChangedListener(object : TextWatcher {
      override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
      override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
      override fun afterTextChanged(s: Editable?) {
        if (!isUpdatingFromJS) {
          listener?.onChange(nodeId, s?.toString() ?: "")
        }
      }
    })

    // Set up focus listener
    textInputEditText.setOnFocusChangeListener { _, hasFocus ->
      if (hasFocus) {
        listener?.onFocus(nodeId)
      } else {
        listener?.onBlur(nodeId)
      }
    }

    // Set up editor action listener for submit/return key
    textInputEditText.setOnEditorActionListener { _, actionId, _ ->
      when (actionId) {
        EditorInfo.IME_ACTION_DONE,
        EditorInfo.IME_ACTION_GO,
        EditorInfo.IME_ACTION_NEXT,
        EditorInfo.IME_ACTION_SEARCH,
        EditorInfo.IME_ACTION_SEND -> {
          listener?.onSubmit(nodeId, textInputEditText.text?.toString() ?: "")
          true
        }
        else -> false
      }
    }
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    // Let TextInputLayout measure itself with unspecified height to get its natural size
    val unspecifiedHeightSpec = MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
    textInputLayout.measure(widthMeasureSpec, unspecifiedHeightSpec)

    val childWidth = textInputLayout.measuredWidth
    val childHeight = textInputLayout.measuredHeight
    
    // Ensure minimum height for Material 3 text field (56dp)
    val minHeight = (MIN_HEIGHT_DP * density).roundToInt()
    val finalHeight = childHeight.coerceAtLeast(minHeight)

    val width = resolveSize(childWidth, widthMeasureSpec)
    
    // For height, respect EXACTLY mode but ensure minimum otherwise
    val heightMode = MeasureSpec.getMode(heightMeasureSpec)
    val heightSize = MeasureSpec.getSize(heightMeasureSpec)
    val height = when (heightMode) {
      MeasureSpec.EXACTLY -> heightSize.coerceAtLeast(minHeight)
      MeasureSpec.AT_MOST -> finalHeight.coerceAtMost(heightSize)
      else -> finalHeight
    }

    setMeasuredDimension(width, height)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val width = right - left
    val height = bottom - top
    textInputLayout.layout(0, 0, width, height)
  }

  /**
   * Sets the text value without triggering the listener.
   */
  fun setValue(value: String) {
    if (textInputEditText.text?.toString() != value) {
      isUpdatingFromJS = true
      textInputEditText.setText(value)
      // Move cursor to end
      textInputEditText.setSelection(value.length)
      isUpdatingFromJS = false
    }
  }

  fun setPlaceholder(placeholder: String) {
    textInputLayout.hint = placeholder
  }

  fun setDisabled(disabled: Boolean) {
    textInputEditText.isEnabled = !disabled
    textInputLayout.alpha = if (disabled) 0.5f else 1.0f
  }

  fun setEditable(editable: Boolean) {
    textInputEditText.isFocusable = editable
    textInputEditText.isFocusableInTouchMode = editable
    textInputEditText.isCursorVisible = editable
  }

  fun setSecureTextEntry(secure: Boolean) {
    val currentInputType = textInputEditText.inputType
    textInputEditText.inputType = if (secure) {
      InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
    } else {
      // Preserve keyboard type settings
      currentInputType and InputType.TYPE_TEXT_VARIATION_PASSWORD.inv()
    }
    // Preserve cursor position
    textInputEditText.setSelection(textInputEditText.text?.length ?: 0)
  }

  fun setKeyboardType(keyboardType: String) {
    val isSecure = (textInputEditText.inputType and InputType.TYPE_TEXT_VARIATION_PASSWORD) != 0
    
    val baseType = when (keyboardType) {
      "numeric" -> InputType.TYPE_CLASS_NUMBER
      "email" -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
      "phone" -> InputType.TYPE_CLASS_PHONE
      "url" -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
      else -> InputType.TYPE_CLASS_TEXT
    }
    
    textInputEditText.inputType = if (isSecure && keyboardType == "default") {
      InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
    } else {
      baseType
    }
  }

  fun setReturnKeyType(returnKeyType: String) {
    textInputEditText.imeOptions = when (returnKeyType) {
      "go" -> EditorInfo.IME_ACTION_GO
      "next" -> EditorInfo.IME_ACTION_NEXT
      "search" -> EditorInfo.IME_ACTION_SEARCH
      "send" -> EditorInfo.IME_ACTION_SEND
      else -> EditorInfo.IME_ACTION_DONE
    }
  }

  fun setAutoCapitalize(autoCapitalize: String) {
    val currentType = textInputEditText.inputType and (
      InputType.TYPE_TEXT_FLAG_CAP_SENTENCES.inv() and
      InputType.TYPE_TEXT_FLAG_CAP_WORDS.inv() and
      InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS.inv()
    )
    
    val capFlag = when (autoCapitalize) {
      "none" -> 0
      "words" -> InputType.TYPE_TEXT_FLAG_CAP_WORDS
      "characters" -> InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
      else -> InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
    }
    
    textInputEditText.inputType = currentType or capFlag
  }

  fun setAutoCorrect(autoCorrect: Boolean) {
    val currentType = textInputEditText.inputType
    textInputEditText.inputType = if (autoCorrect) {
      currentType or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
    } else {
      currentType and InputType.TYPE_TEXT_FLAG_AUTO_CORRECT.inv() or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
    }
  }

  fun setMaxLength(maxLen: Int) {
    maxLength = if (maxLen > 0) maxLen else Int.MAX_VALUE
    
    // Preserve existing filters, removing any old LengthFilter
    val currentFilters = textInputEditText.filters.filter { it !is InputFilter.LengthFilter }.toMutableList()
    
    if (maxLength < Int.MAX_VALUE) {
      currentFilters.add(InputFilter.LengthFilter(maxLength))
    }
    
    textInputEditText.filters = currentFilters.toTypedArray()
  }

  fun requestFocusField() {
    textInputEditText.requestFocus()
    val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    imm.showSoftInput(textInputEditText, InputMethodManager.SHOW_IMPLICIT)
  }

  fun requestBlurField() {
    textInputEditText.clearFocus()
    val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    imm.hideSoftInputFromWindow(textInputEditText.windowToken, 0)
  }

  fun setVariant(variant: String) {
    currentVariant = variant
    when (variant) {
      "outlined" -> {
        textInputLayout.boxBackgroundMode = TextInputLayout.BOX_BACKGROUND_OUTLINE
        // Reset EditText background
        textInputEditText.background = null
        // Outlined mode should have equal corner radii on all 4 corners
        // Material 3 default is 4dp, but respect custom radius if set
        val radiusPx = currentBorderRadius?.let { it * density } ?: (4 * density)
        textInputLayout.setBoxCornerRadii(radiusPx, radiusPx, radiusPx, radiusPx)
        // Set background color (transparent by default for outlined, or custom if set)
        textInputLayout.boxBackgroundColor = currentBackgroundColor ?: Color.TRANSPARENT
      }
      "none" -> {
        // For "none" variant, we need to completely remove all M3 styling
        textInputLayout.boxBackgroundMode = TextInputLayout.BOX_BACKGROUND_NONE
        textInputLayout.boxBackgroundColor = Color.TRANSPARENT
        // Remove the underline/stroke
        textInputLayout.boxStrokeWidth = 0
        textInputLayout.boxStrokeWidthFocused = 0
        // Clear all corner radii on the layout
        textInputLayout.setBoxCornerRadii(0f, 0f, 0f, 0f)
        // Apply current background to EditText with rounded corners if needed
        applyEditTextBackground()
      }
      else -> { // "filled" is default
        textInputLayout.boxBackgroundMode = TextInputLayout.BOX_BACKGROUND_FILLED
        // Reset EditText background - let TextInputLayout handle it
        textInputEditText.background = null
        // Only set background color if explicitly provided by the user
        // Otherwise, let Material 3 handle its default background (don't interfere!)
        if (currentBackgroundColor != null) {
          textInputLayout.boxBackgroundColor = currentBackgroundColor!!
        }
        // Note: We intentionally do NOT set defaultFilledBackgroundColor here
        // because TextInputLayout already has the correct default from the theme
        
        // Apply custom border radius if set (filled mode has rounded top, flat bottom by default)
        currentBorderRadius?.let { radius ->
          val radiusPx = radius * density
          // Keep M3's top-only rounded corners for filled variant
          textInputLayout.setBoxCornerRadii(radiusPx, radiusPx, 0f, 0f)
        }
      }
    }
  }

  private fun applyEditTextBackground() {
    // Only apply custom background drawable for "none" variant
    if (currentVariant != "none") {
      return
    }
    
    val bgColor = currentBackgroundColor ?: Color.TRANSPARENT
    val radiusPx = (currentBorderRadius ?: 0f) * density
    
    val drawable = android.graphics.drawable.GradientDrawable().apply {
      setColor(bgColor)
      cornerRadius = radiusPx
    }
    textInputEditText.background = drawable
    
    // Add padding for text when using custom background
    val paddingPx = (12 * density).toInt()
    textInputEditText.setPadding(paddingPx, paddingPx / 2, paddingPx, paddingPx / 2)
  }

  fun setBackgroundColor(colorString: String?) {
    val color = colorString?.let { parseColor(it) }
    currentBackgroundColor = color
    
    if (currentVariant == "none") {
      // For "none" variant, apply directly to EditText with rounded corners
      applyEditTextBackground()
    } else if (color != null) {
      // For filled/outlined, set the background color
      textInputLayout.boxBackgroundColor = color
      
      // For filled variant, ensure we have the proper rounded corners
      // when setting a custom background color
      if (currentVariant == "filled") {
        val radiusPx = (currentBorderRadius ?: DEFAULT_CORNER_RADIUS_DP) * density
        // If user set a custom borderRadius, use it on all corners
        // Otherwise use M3 default: rounded top, flat bottom
        if (currentBorderRadius != null) {
          textInputLayout.setBoxCornerRadii(radiusPx, radiusPx, radiusPx, radiusPx)
        } else {
          textInputLayout.setBoxCornerRadii(radiusPx, radiusPx, 0f, 0f)
        }
      }
    }
    // Note: We intentionally do nothing when color is null for filled/outlined
    // This allows Material 3 to handle its default background color
  }

  fun setBorderRadius(radius: Float) {
    currentBorderRadius = radius
    val radiusPx = radius * density
    
    if (currentVariant == "none") {
      // For "none" variant, apply to EditText background
      applyEditTextBackground()
    } else {
      // For filled/outlined, when user explicitly sets borderRadius,
      // apply equal corners on all sides (user is customizing the shape)
      textInputLayout.setBoxCornerRadii(radiusPx, radiusPx, radiusPx, radiusPx)
      
      // For filled variant with custom border radius, hide the bottom underline indicator
      // since it would cut across the rounded bottom corners
      if (currentVariant == "filled") {
        textInputLayout.boxStrokeWidth = 0
        textInputLayout.boxStrokeWidthFocused = 0
      }
    }
  }

  fun setBorderWidth(width: Float) {
    currentBorderWidth = width
    val widthPx = (width * density).roundToInt()
    textInputLayout.boxStrokeWidth = widthPx
    textInputLayout.boxStrokeWidthFocused = widthPx
  }

  fun setBorderColor(colorString: String?) {
    val color = colorString?.let { parseColor(it) }
    hasCustomBorderColor = color != null
    
    if (color != null) {
      // Create a ColorStateList that uses the same color for ALL states
      // This includes: focused, unfocused, hovered, error, disabled
      val states = arrayOf(
        intArrayOf(android.R.attr.state_focused),
        intArrayOf(android.R.attr.state_hovered),
        intArrayOf(-android.R.attr.state_enabled),
        intArrayOf() // default state
      )
      val colors = intArrayOf(color, color, color, color)
      val colorStateList = android.content.res.ColorStateList(states, colors)
      
      // Set the stroke color state list for all states
      textInputLayout.setBoxStrokeColorStateList(colorStateList)
      
      // Also set the focused stroke color explicitly
      textInputLayout.boxStrokeColor = color
    }
  }

  fun setTextColor(colorString: String?) {
    val color = colorString?.let { parseColor(it) }
    if (color != null) {
      textInputEditText.setTextColor(color)
    }
  }

  fun setPlaceholderColor(colorString: String?) {
    val color = colorString?.let { parseColor(it) }
    if (color != null) {
      // Set hint color on the TextInputLayout
      textInputLayout.hintTextColor = android.content.res.ColorStateList.valueOf(color)
      // Also set the default hint color for when not focused
      textInputLayout.defaultHintTextColor = android.content.res.ColorStateList.valueOf(color)
    }
  }

  private fun parseColor(colorStr: String): Int? {
    return try {
      when {
        colorStr == "transparent" -> Color.TRANSPARENT
        colorStr.startsWith("#") -> Color.parseColor(colorStr)
        colorStr.startsWith("rgba(") -> parseRgba(colorStr)
        colorStr.startsWith("rgb(") -> parseRgb(colorStr)
        else -> Color.parseColor("#$colorStr")
      }
    } catch (e: Exception) {
      null
    }
  }

  private fun parseRgba(rgba: String): Int {
    val values = rgba.removePrefix("rgba(").removeSuffix(")").split(",").map { it.trim() }
    val r = values[0].toInt()
    val g = values[1].toInt()
    val b = values[2].toInt()
    val a = (values[3].toFloat() * 255).roundToInt()
    return Color.argb(a, r, g, b)
  }

  private fun parseRgb(rgb: String): Int {
    val values = rgb.removePrefix("rgb(").removeSuffix(")").split(",").map { it.trim() }
    val r = values[0].toInt()
    val g = values[1].toInt()
    val b = values[2].toInt()
    return Color.rgb(r, g, b)
  }
}
