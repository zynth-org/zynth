package com.rune.components.textfield

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
 * A native Material 3 TextField for Rune.
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
class RuneTextFieldView(context: Context) : FrameLayout(context) {

  var nodeId: Int = -1

  /** Listener for text field events */
  var listener: Listener? = null

  private val textInputLayout: TextInputLayout
  private val textInputEditText: TextInputEditText
  private val density = resources.displayMetrics.density

  private var isUpdatingFromJS = false
  private var maxLength: Int = Int.MAX_VALUE

  interface Listener {
    fun onChange(nodeId: Int, value: String)
    fun onFocus(nodeId: Int)
    fun onBlur(nodeId: Int)
    fun onSubmit(nodeId: Int, value: String)
  }

  companion object {
    private const val TAG = "RuneTextFieldView"
    private const val MIN_HEIGHT_DP = 56 // Material 3 minimum height for filled text field
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
    
    val filters = if (maxLength < Int.MAX_VALUE) {
      arrayOf<InputFilter>(InputFilter.LengthFilter(maxLength))
    } else {
      arrayOf()
    }
    textInputEditText.filters = filters
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
}
