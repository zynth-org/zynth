package com.rune.kit.core

import android.content.Context
import android.graphics.Color
import android.graphics.Rect
import android.graphics.Typeface
import android.os.Build
import android.os.SystemClock
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextWatcher
import android.util.AttributeSet
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper
import android.view.inputmethod.InputMethodManager
import android.widget.TextView
import androidx.appcompat.widget.AppCompatEditText
import androidx.core.graphics.ColorUtils
import androidx.core.graphics.drawable.DrawableCompat
import androidx.core.view.ViewCompat
import org.json.JSONObject
import java.util.ArrayDeque

internal open class RuneTextInputView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
) : AppCompatEditText(context, attrs) {

  internal var manager: RuneUIManager? = null
  internal var nodeId: Int = -1

  // Event registration flags
  internal var hasOnChange = false
  internal var hasOnChangeText = false
  internal var hasOnSelectionChange = false
  internal var hasOnFocus = false
  internal var hasOnBlur = false
  internal var hasOnSubmitEditing = false
  internal var hasOnKeyPress = false
  internal var hasOnCompositionStart = false
  internal var hasOnCompositionEnd = false

  internal var blurOnSubmit = false
  internal var submitBehavior: String = "submit"
  internal var allowProgrammaticJumpDuringEdit = false
  internal var eventThrottleMs: Long = 0L

  private var lastChangeDispatchTime = 0L
  private var suppressNativeEvent = false
  private var selectionWatcherEnabled = true
  private var isComposingText = false
  private var didEmitFocus = false

  private var pendingChange: PendingChange? = null
  private var numberOfLinesHint: Int = 0

  private var inputMode: String? = null
  private var autoCapitalize: String? = null
  private var autoCorrect: Boolean? = null
  private var spellCheck: Boolean? = null
  private var secureEntry = false
  private var multiline = false
  private var styledPaddingLeft = 0
  private var styledPaddingTop = 0
  private var styledPaddingRight = 0
  private var styledPaddingBottom = 0
  private var lastExactHeight = 0
  private var visualInsetTop = 0
  private var visualInsetBottom = 0
  private var targetCenteredHeight = 0
  private var applyingInternalPadding = false

  private var lengthFilter: InputFilter.LengthFilter? = null
  internal var maxLength: Int = -1
    set(value) {
      field = value
      applyMaxLengthFilter()
    }

  private var externalFocusListener: OnFocusChangeListener? = null
  private var externalEditorActionListener: TextView.OnEditorActionListener? = null
  private val pendingPostRevealCallbacks = ArrayDeque<() -> Unit>()
  private var hasCompletedFirstReveal = false
  private var postRevealDispatchScheduled = false
  private var pendingFocusEmission = false

  private val changeWatcher = object : TextWatcher {
    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {
      if (suppressNativeEvent) return
      val removed = if (count > 0 && start + count <= (s?.length ?: 0)) {
        s?.subSequence(start, start + count)?.toString() ?: ""
      } else {
        ""
      }
      pendingChange = PendingChange(start, start + count, removed = removed)
    }

    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
      if (suppressNativeEvent) return
      val inserted = if (count > 0 && start + count <= (s?.length ?: 0)) {
        s?.subSequence(start, start + count)?.toString() ?: ""
      } else {
        ""
      }
      val change = pendingChange
      if (change != null) {
        change.inserted = inserted
        change.rangeEnd = start + before
      } else {
        pendingChange = PendingChange(start, start + before, inserted = inserted)
      }

      if (hasOnKeyPress) {
        if (count == 0 && before > 0) {
          emitKeyEvent("")
        } else if (inserted.isNotEmpty()) {
          emitKeyEvent(inserted)
        }
      }
    }

    override fun afterTextChanged(s: Editable?) {
      val mgr = manager ?: return
      if (suppressNativeEvent) {
        pendingChange = null
        mgr.onTextInputTextUpdated(nodeId, text?.toString().orEmpty())
        mgr.onTextInputIntrinsicSizeChanged(nodeId)
        return
      }

      val change = pendingChange ?: PendingChange(0, 0)
      pendingChange = null

      if (shouldThrottleEvent()) {
        mgr.onTextInputTextUpdated(nodeId, text?.toString().orEmpty())
        mgr.onTextInputIntrinsicSizeChanged(nodeId)
        return
      }

      emitChange(change)
      recordEventDispatch()
      mgr.onTextInputTextUpdated(nodeId, text?.toString().orEmpty())
      mgr.onTextInputIntrinsicSizeChanged(nodeId)

      val nowComposing = isComposing()
      if (nowComposing != isComposingText) {
        updateCompositionState(nowComposing)
      } else if (!nowComposing && isComposingText) {
        updateCompositionState(false)
      }
    }
  }

  private val internalFocusListener = OnFocusChangeListener { v, hasFocus ->
    if (hasFocus) {
      emitFocusIfNeeded()
    } else {
      emitBlurIfNeeded()
    }
    externalFocusListener?.onFocusChange(v, hasFocus)
  }

  private val internalEditorActionListener = TextView.OnEditorActionListener { v, actionId, event ->
    if (handleEditorAction(actionId, event)) {
      true
    } else {
      externalEditorActionListener?.onEditorAction(v, actionId, event) ?: false
    }
  }

  init {
    background = null
    setTextColor(Color.WHITE)
    typeface = Typeface.DEFAULT
    textSize = 16f
    imeOptions = imeOptions or EditorInfo.IME_FLAG_NO_EXTRACT_UI
    overScrollMode = View.OVER_SCROLL_NEVER
    isVerticalScrollBarEnabled = false
    isVerticalFadingEdgeEnabled = false
    setFadingEdgeLength(0)
    setHorizontallyScrolling(false)
    isSingleLine = true
    isFocusable = true
    isFocusableInTouchMode = true
    isClickable = true
    includeFontPadding = false
    setMinHeight(0)
    setMinimumHeight(0)
    updateGravity()
    applyBaselineAlignment()

    super.setOnFocusChangeListener(internalFocusListener)
    super.setOnEditorActionListener(internalEditorActionListener)
    addTextChangedListener(changeWatcher)
    updatePlaceholderTone()
    ensureBaselineConstraints()
    styledPaddingLeft = paddingLeft
    styledPaddingTop = paddingTop
    styledPaddingRight = paddingRight
    styledPaddingBottom = paddingBottom
  }

  override fun setOnFocusChangeListener(l: OnFocusChangeListener?) {
    externalFocusListener = l
    super.setOnFocusChangeListener(internalFocusListener)
  }

  override fun setOnEditorActionListener(l: TextView.OnEditorActionListener?) {
    externalEditorActionListener = l
    super.setOnEditorActionListener(internalEditorActionListener)
  }

  fun getStyledPadding(): PaddingValues {
    return PaddingValues(styledPaddingLeft, styledPaddingTop, styledPaddingRight, styledPaddingBottom)
  }

  data class PaddingValues(val left: Int, val top: Int, val right: Int, val bottom: Int)

  fun performProgrammaticUpdate(block: () -> Unit) {
    val previous = suppressNativeEvent
    suppressNativeEvent = true
    try {
      block()
    } finally {
      suppressNativeEvent = previous
      // Ensure layout updates after programmatic changes
      manager?.onTextInputIntrinsicSizeChanged(nodeId)
    }
  }

  fun applyPlaceholder(text: String?) {
    hint = text
    updatePlaceholderTone()
  }

  fun applyEditable(editable: Boolean) {
    isEnabled = editable
    isFocusable = editable
    isFocusableInTouchMode = editable
    isClickable = editable
  }

  fun applyMultiline(enabled: Boolean) {
    if (secureEntry && enabled) {
      Log.w("RuneTextInputView", "Secure text inputs do not support multiline on Android; ignoring request.")
      multiline = false
    } else {
      multiline = enabled
    }
    applyBaselineAlignment()
    updateInputConfiguration()
    val lines = when {
      !multiline -> 1
      numberOfLinesHint > 0 -> numberOfLinesHint
      else -> Int.MAX_VALUE
    }
    setLines(lines.coerceAtLeast(1))
    maxLines = lines
    isSingleLine = !multiline
    updateGravity()
    ensureBaselineConstraints()
    manager?.onTextInputIntrinsicSizeChanged(nodeId)
  }

  fun applyNumberOfLines(lines: Int) {
    numberOfLinesHint = lines
    if (multiline) {
      val resolved = when {
        lines <= 0 -> Int.MAX_VALUE
        else -> lines
      }
      setLines(resolved)
      maxLines = resolved
    }
    updateGravity()
    ensureBaselineConstraints()
    manager?.onTextInputIntrinsicSizeChanged(nodeId)
  }

  internal fun ensureBaselineConstraints(): Boolean {
    if (!multiline) {
      var adjusted = false
      if (minHeight != 0 || minimumHeight != 0) {
        setMinHeight(0)
        setMinimumHeight(0)
        adjusted = true
      }
      if (scrollY != 0) {
        Log.d(
          "RuneTextInputView",
          "ensureBaselineConstraints resetting scrollY=$scrollY paddingTop=$paddingTop paddingBottom=$paddingBottom",
        )
        scrollTo(scrollX, 0)
        adjusted = true
      }
      return adjusted
    }

    val baseLineHeight = lineHeight.coerceAtLeast(1)
    val resolvedLines = when {
      numberOfLinesHint > 0 -> numberOfLinesHint.coerceAtLeast(1)
      maxLines in 1 until Int.MAX_VALUE -> maxLines
      else -> 2
    }

    val paddedHeight = (baseLineHeight * resolvedLines) + paddingTop + paddingBottom
    val enforced = paddedHeight.coerceAtLeast(1)

    var changed = false
    if (minHeight != enforced) {
      setMinHeight(enforced)
      changed = true
    }
    if (minimumHeight != enforced) {
      setMinimumHeight(enforced)
      changed = true
    }
    if (changed) {
      Log.d(
        "RuneTextInputView",
        "ensureBaselineConstraints multiline enforcedHeight=$enforced paddingTop=$paddingTop paddingBottom=$paddingBottom",
      )
    }

    return changed
  }

  fun applySecureEntry(isSecure: Boolean) {
    if (secureEntry == isSecure) return
    secureEntry = isSecure
    isLongClickable = !secureEntry
    setTextIsSelectable(!secureEntry)
    isFocusable = true
    isFocusableInTouchMode = true
    isClickable = true
    updateInputConfiguration(preserveSelection = true)
    updateGravity()
    manager?.onTextInputIntrinsicSizeChanged(nodeId)
  }

  fun applyInputMode(mode: String?) {
    inputMode = mode
    updateInputConfiguration(preserveSelection = true)
  }

  fun applyAutoCapitalize(mode: String?) {
    autoCapitalize = mode
    updateInputConfiguration(preserveSelection = true)
  }

  fun applyAutoCorrect(value: Boolean?) {
    autoCorrect = value
    updateInputConfiguration(preserveSelection = true)
  }

  fun applySpellCheck(value: Boolean?) {
    spellCheck = value
    updateInputConfiguration(preserveSelection = true)
  }

  fun applyReturnKeyType(type: String?) {
    val base = imeOptions and EditorInfo.IME_MASK_ACTION.inv()
    val action = when (type?.lowercase()) {
      "go" -> EditorInfo.IME_ACTION_GO
      "next" -> EditorInfo.IME_ACTION_NEXT
      "search" -> EditorInfo.IME_ACTION_SEARCH
      "send" -> EditorInfo.IME_ACTION_SEND
      "done" -> EditorInfo.IME_ACTION_DONE
      else -> EditorInfo.IME_ACTION_DONE
    }
    imeOptions = base or action or EditorInfo.IME_FLAG_NO_EXTRACT_UI
  }

  fun applySelectionColor(hex: Int?) {
    hex?.let { setHighlightColor(it) }
  }

  fun applyCaretColor(hex: Int?) {
    if (hex == null) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val cursor = textCursorDrawable
      if (cursor != null) {
        val wrapped = DrawableCompat.wrap(cursor.mutate())
        DrawableCompat.setTint(wrapped, hex)
        textCursorDrawable = wrapped
      }
    }
  }

  fun applySelection(start: Int, end: Int) {
    runAfterReveal {
      val length = text?.length ?: 0
      val clampedStart = start.coerceIn(0, length)
      val clampedEnd = end.coerceIn(0, length)
      val finalStart = minOf(clampedStart, clampedEnd)
      val finalEnd = maxOf(clampedStart, clampedEnd)
      val previous = selectionWatcherEnabled
      selectionWatcherEnabled = false
      try {
        setSelection(finalStart, finalEnd)
      } catch (_: Throwable) {
        // Defensive: ignore selection issues caused by stale positions
      } finally {
        selectionWatcherEnabled = previous
      }
    }
  }

  fun applyEventThrottle(throttleMs: Long) {
    eventThrottleMs = throttleMs
  }

  fun requestFocusFromJS() {
    runAfterReveal {
      if (!isFocusable || !isEnabled) return@runAfterReveal
      if (!hasFocus()) {
        requestFocus()
      }
      post {
        val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.showSoftInput(this, InputMethodManager.SHOW_IMPLICIT)
      }
    }
  }

  fun clearHandlers() {
    hasOnChange = false
    hasOnChangeText = false
    hasOnSelectionChange = false
    hasOnFocus = false
    hasOnBlur = false
    hasOnSubmitEditing = false
    hasOnKeyPress = false
    hasOnCompositionStart = false
    hasOnCompositionEnd = false
    didEmitFocus = false
    isComposingText = false
    pendingFocusEmission = false
  }

  override fun setTextColor(color: Int) {
    super.setTextColor(color)
    updatePlaceholderTone()
  }

  override fun onFocusChanged(
    focused: Boolean,
    direction: Int,
    previouslyFocusedRect: Rect?,
  ) {
    super.onFocusChanged(focused, direction, previouslyFocusedRect)
    if (focused) {
      emitFocusIfNeeded()
    } else {
      if (isComposingText) {
        updateCompositionState(false)
      }
      emitBlurIfNeeded()
    }
  }

  override fun onSelectionChanged(selStart: Int, selEnd: Int) {
    super.onSelectionChanged(selStart, selEnd)
    if (!selectionWatcherEnabled) return
    emitSelectionChanged(selStart, selEnd)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    if (!multiline) {
      val totalHeight = bottom - top
      updateVisualInsets(totalHeight)
      Log.d(
        "RuneTextInputView",
        "onLayout singleLine height=$totalHeight paddingTop=$paddingTop paddingBottom=$paddingBottom baseline=$baseline scrollY=$scrollY visualInsetTop=$visualInsetTop visualInsetBottom=$visualInsetBottom",
      )
      val contentHeight = styledPaddingTop + styledPaddingBottom + lineHeight
      if (totalHeight > contentHeight) {
        lastExactHeight = totalHeight
        manager?.onTextInputLayout(nodeId, totalHeight)
      }
    }
    val hasSize = (right - left) > 0 && (bottom - top) > 0
    if (hasSize && !hasCompletedFirstReveal) {
      hasCompletedFirstReveal = true
      schedulePostRevealDispatch()
    }
  }

  private fun runAfterReveal(action: () -> Unit) {
    if (hasCompletedFirstReveal) {
      action()
      return
    }
    pendingPostRevealCallbacks.add(action)
  }

  private fun schedulePostRevealDispatch() {
    if (pendingPostRevealCallbacks.isEmpty() || postRevealDispatchScheduled) return
    postRevealDispatchScheduled = true
    ViewCompat.postOnAnimation(this) {
      postRevealDispatchScheduled = false
      while (pendingPostRevealCallbacks.isNotEmpty()) {
        pendingPostRevealCallbacks.removeFirst().invoke()
      }
    }
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    if (keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN) {
      if (handleEditorAction(EditorInfo.IME_NULL, event)) {
        return true
      }
    }
    return super.onKeyDown(keyCode, event)
  }

  override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection {
    val base = super.onCreateInputConnection(outAttrs)
    return RuneInputConnection(base, true)
  }

  override fun isSuggestionsEnabled(): Boolean {
    return if (secureEntry) false else super.isSuggestionsEnabled()
  }

  override fun onTextContextMenuItem(id: Int): Boolean {
    return if (secureEntry) false else super.onTextContextMenuItem(id)
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    // Ensure we do not leak callbacks
    pendingChange = null
    pendingPostRevealCallbacks.clear()
    postRevealDispatchScheduled = false
    hasCompletedFirstReveal = false
    pendingFocusEmission = false
    didEmitFocus = false
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    if (!multiline) {
      val mode = View.MeasureSpec.getMode(heightMeasureSpec)
      val size = View.MeasureSpec.getSize(heightMeasureSpec)
      when (mode) {
        View.MeasureSpec.EXACTLY -> {
          lastExactHeight = size
          Log.d(
            "RuneTextInputView",
            "onMeasure singleLine exact measuredHeight=$measuredHeight size=$size paddingTop=$paddingTop paddingBottom=$paddingBottom lineHeight=$lineHeight",
          )
        }
        else -> {
          if (lastExactHeight > 0) {
            val target = lastExactHeight.coerceAtLeast(measuredHeight)
            if (target != measuredHeight) {
              setMeasuredDimension(measuredWidth, target)
              Log.d(
                "RuneTextInputView",
                "onMeasure adjusted singleLine measuredHeight=$target (fromExact=$lastExactHeight) paddingTop=$paddingTop paddingBottom=$paddingBottom lineHeight=$lineHeight mode=$mode size=$size",
              )
              updateVisualInsets(target)
            } else {
              Log.d(
                "RuneTextInputView",
                "onMeasure singleLine reuse measuredHeight=$measuredHeight (exact=$lastExactHeight) paddingTop=$paddingTop paddingBottom=$paddingBottom lineHeight=$lineHeight mode=$mode size=$size",
              )
            }
          } else {
            Log.d(
              "RuneTextInputView",
              "onMeasure singleLine measuredHeight=$measuredHeight mode=$mode size=$size paddingTop=$paddingTop paddingBottom=$paddingBottom lineHeight=$lineHeight",
            )
          }
        }
      }
    }
  }

  private fun handleEditorAction(actionId: Int, event: KeyEvent?): Boolean {
    val keyEvent = event?.takeIf { it.action == KeyEvent.ACTION_DOWN }
    val isEnterKey = keyEvent?.keyCode == KeyEvent.KEYCODE_ENTER
    val isSubmitAction = when (actionId) {
      EditorInfo.IME_ACTION_GO,
      EditorInfo.IME_ACTION_SEND,
      EditorInfo.IME_ACTION_SEARCH,
      EditorInfo.IME_ACTION_DONE -> true
      EditorInfo.IME_ACTION_NEXT -> submitBehavior.lowercase() == "submit"
      else -> false
    }

    val shouldHandle = isSubmitAction || isEnterKey
    if (!shouldHandle) return false

    val allowNewline = multiline && submitBehavior.equals("newline", ignoreCase = true)
    val shouldSubmit = !submitBehavior.equals("none", ignoreCase = true) && !allowNewline

    if (shouldSubmit) {
      emitSubmitEditing()
      if (blurOnSubmit) {
        post { clearFocus() }
      }
    }

    return shouldSubmit && !allowNewline
  }

  private fun emitFocusIfNeeded() {
    if (!hasOnFocus || didEmitFocus) return
    val dispatch: () -> Unit = l@{
      if (!hasOnFocus || didEmitFocus) return@l
      didEmitFocus = true
      manager?.emitTextInputEvent(nodeId, "onFocus", null)
    }
    if (!hasCompletedFirstReveal) {
      if (pendingFocusEmission) return
      pendingFocusEmission = true
      runAfterReveal {
        pendingFocusEmission = false
        dispatch()
      }
      return
    }
    dispatch()
  }

  private fun emitBlurIfNeeded() {
    if (!hasOnBlur || !didEmitFocus) return
    didEmitFocus = false
    pendingFocusEmission = false
    manager?.emitTextInputEvent(nodeId, "onBlur", null)
  }

  private fun emitSelectionChanged(start: Int, end: Int) {
    if (!hasOnSelectionChange) return
    val payload = JSONObject()
    try {
      val selection = JSONObject()
      selection.put("start", start)
      selection.put("end", end)
      payload.put("selection", selection)
    } catch (t: Throwable) {
      Log.w("RuneTextInputView", "Failed to build selection payload", t)
    }
    manager?.emitTextInputEvent(nodeId, "onSelectionChange", payload)
  }

  private fun emitKeyEvent(replacement: String) {
    if (!hasOnKeyPress) return
    val payload = JSONObject()
    try {
      val keyName = if (replacement.isEmpty()) "Backspace" else replacement
      payload.put("key", keyName)
      payload.put("repeat", false)
    } catch (t: Throwable) {
      Log.w("RuneTextInputView", "Failed to build key event payload", t)
    }
    manager?.emitTextInputEvent(nodeId, "onKeyPress", payload)
  }

  private fun emitSubmitEditing() {
    if (!hasOnSubmitEditing) return
    val payload = JSONObject()
    try {
      payload.put("text", text?.toString().orEmpty())
    } catch (t: Throwable) {
      Log.w("RuneTextInputView", "Failed to build submit payload", t)
    }
    manager?.emitTextInputEvent(nodeId, "onSubmitEditing", payload)
  }

  private fun emitChange(change: PendingChange) {
    val payload = JSONObject()
    try {
      val range = JSONObject()
      range.put("start", change.rangeStart.coerceAtLeast(0))
      range.put("end", change.rangeStart.coerceAtLeast(0) + (change.rangeEnd - change.rangeStart).coerceAtLeast(0))
      payload.put("range", range)
      payload.put("inserted", change.inserted)
      payload.put("removed", change.removed)
      payload.put("textAfter", text?.toString().orEmpty())
      payload.put("composing", isComposingText)
    } catch (t: Throwable) {
      Log.w("RuneTextInputView", "Failed to build text change payload", t)
    }

    if (hasOnChange) {
      manager?.emitTextInputEvent(nodeId, "onChange", payload)
    }

    if (hasOnChangeText) {
      val textPayload = JSONObject()
      try {
        textPayload.put("text", text?.toString().orEmpty())
      } catch (t: Throwable) {
        Log.w("RuneTextInputView", "Failed to build changeText payload", t)
      }
      manager?.emitTextInputEvent(nodeId, "onChangeText", textPayload)
    }
  }

  private fun shouldThrottleEvent(): Boolean {
    if (eventThrottleMs <= 0) return false
    val now = SystemClock.uptimeMillis()
    return now - lastChangeDispatchTime < eventThrottleMs
  }

  private fun recordEventDispatch() {
    lastChangeDispatchTime = SystemClock.uptimeMillis()
  }

  private fun applyMaxLengthFilter() {
    val existing = filters?.filterNot { it === lengthFilter }?.toMutableList() ?: mutableListOf()
    if (maxLength > 0) {
      val filter = InputFilter.LengthFilter(maxLength)
      existing.add(filter)
      lengthFilter = filter
    } else {
      lengthFilter = null
    }
    filters = existing.toTypedArray()
  }

  private fun updateInputConfiguration(preserveSelection: Boolean = false) {
    val start = if (preserveSelection) selectionStart else -1
    val end = if (preserveSelection) selectionEnd else -1
    val currentTypeface = typeface

    var computed = when (inputMode?.lowercase()) {
      "numeric" -> InputType.TYPE_CLASS_NUMBER
      "decimal" -> InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
      "tel" -> InputType.TYPE_CLASS_PHONE
      "email" -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
      "url" -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
      "search" -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_WEB_EDIT_TEXT
      else -> InputType.TYPE_CLASS_TEXT
    }

    if (secureEntry) {
      computed = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
      multiline = false
    }

    computed = if (multiline) {
      computed or InputType.TYPE_TEXT_FLAG_MULTI_LINE
    } else {
      computed and InputType.TYPE_TEXT_FLAG_MULTI_LINE.inv()
    }

    computed = computed and InputType.TYPE_TEXT_FLAG_CAP_SENTENCES.inv()
    computed = computed and InputType.TYPE_TEXT_FLAG_CAP_WORDS.inv()
    computed = computed and InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS.inv()

    when (autoCapitalize?.lowercase()) {
      "sentences" -> computed = computed or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
      "words" -> computed = computed or InputType.TYPE_TEXT_FLAG_CAP_WORDS
      "characters" -> computed = computed or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
    }

    val disableSuggestions = secureEntry || autoCorrect == false || spellCheck == false
    computed = if (disableSuggestions) {
      computed or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
    } else {
      computed and InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS.inv()
    }

    if (autoCorrect == true && !disableSuggestions) {
      computed = computed or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
    } else {
      computed = computed and InputType.TYPE_TEXT_FLAG_AUTO_CORRECT.inv()
    }

    super.setInputType(computed)
    if (currentTypeface != null) {
      typeface = currentTypeface
    }
    if (preserveSelection && start >= 0 && end >= 0) {
      val previous = selectionWatcherEnabled
      selectionWatcherEnabled = false
      try {
        setSelection(start.coerceAtLeast(0), end.coerceAtLeast(0))
      } catch (_: Throwable) {
        // ignore
      } finally {
        selectionWatcherEnabled = previous
      }
    }
    updateGravity()
  }

  private fun updatePlaceholderTone() {
    val base = currentTextColor
    val hintColor = ColorUtils.setAlphaComponent(base, (Color.alpha(base) * 0.45f).toInt().coerceIn(0, 255))
    setHintTextColor(hintColor)
  }

  private fun isComposing(): Boolean {
    val editable = text ?: return false
    val composingSpans = editable.getSpans(0, editable.length, Any::class.java)
    return composingSpans.any { editable.getSpanFlags(it) and 0x100 != 0 }
  }

  private fun updateCompositionState(starting: Boolean) {
    if (starting) {
      if (!hasOnCompositionStart || isComposingText) return
      isComposingText = true
      manager?.emitTextInputEvent(nodeId, "onCompositionStart", null)
    } else {
      if (!hasOnCompositionEnd || !isComposingText) return
      isComposingText = false
      manager?.emitTextInputEvent(nodeId, "onCompositionEnd", null)
    }
  }

  private data class PendingChange(
    val rangeStart: Int,
    var rangeEnd: Int,
    var inserted: String = "",
    var removed: String = "",
  )

  private fun updateGravity() {
    gravity = if (multiline) {
      Gravity.START or Gravity.TOP
    } else {
      Gravity.START or Gravity.CENTER_VERTICAL
    }
  }

  private fun applyBaselineAlignment() {
    if (!multiline) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
        textAlignment = View.TEXT_ALIGNMENT_VIEW_START
      }
    }
  }

  override fun scrollTo(x: Int, y: Int) {
    val targetY = if (!multiline) 0 else y
    if (!multiline && y != 0) {
      Log.d(
        "RuneTextInputView",
        "scrollTo suppressed vertical scroll from y=$y paddingTop=$paddingTop paddingBottom=$paddingBottom",
      )
    }
    super.scrollTo(x, targetY)
  }

  internal fun updateStylePadding(left: Int, top: Int, right: Int, bottom: Int): Boolean {
    val changed = styledPaddingLeft != left || styledPaddingTop != top || styledPaddingRight != right || styledPaddingBottom != bottom
    styledPaddingLeft = left
    styledPaddingTop = top
    styledPaddingRight = right
    styledPaddingBottom = bottom
    applyCurrentPadding()
    if (!multiline && changed) {
      lastExactHeight = 0 // Reset if styled padding changes significantly
      manager?.clearTextInputExactHeight(nodeId)
      // Recalculate inset based on new base padding and current height/exact height
      val currentHeight = if (height > 0) height else measuredHeight
      if (currentHeight > 0) {
          updateVisualInsets(currentHeight)
      }
    }
    return changed
  }

  internal fun setExpectedExactHeight(height: Int) {
    if (!multiline && height > 0) {
      lastExactHeight = height
      updateVisualInsets(height)
    }
  }

  private fun updateVisualInsets(totalHeight: Int) {
    if (multiline || totalHeight <= 0) {
      if (visualInsetTop != 0 || visualInsetBottom != 0) {
        visualInsetTop = 0
        visualInsetBottom = 0
        // Update target height if multiline becomes true
        targetCenteredHeight = 0
        applyCurrentPadding()
      }
      return
    }

    // Calculate the minimum height needed just for styled padding and line content
    val minimumContentHeight = styledPaddingTop + styledPaddingBottom + lineHeight

    val targetHeightForCentering = if (lastExactHeight > 0) {
         lastExactHeight
     } else {
         totalHeight.coerceAtLeast(minimumContentHeight)
     }

    val extraSpace = (targetHeightForCentering - minimumContentHeight).coerceAtLeast(0)
    val desiredTop = extraSpace / 2
    val desiredBottom = extraSpace - desiredTop

    if (desiredTop != visualInsetTop || desiredBottom != visualInsetBottom) {
      visualInsetTop = desiredTop
      visualInsetBottom = desiredBottom
      // Update the targetCenteredHeight whenever visualInset changes
      targetCenteredHeight = minimumContentHeight + extraSpace
      applyCurrentPadding()
    }
  }

  private fun applyCurrentPadding() {
    val finalLeft = styledPaddingLeft
    val finalTop = styledPaddingTop + visualInsetTop
    val finalRight = styledPaddingRight
    val finalBottom = styledPaddingBottom + visualInsetBottom
    setActualPadding(finalLeft, finalTop, finalRight, finalBottom)
  }

  private fun setActualPadding(left: Int, top: Int, right: Int, bottom: Int) {
    if (paddingLeft == left && paddingTop == top && paddingRight == right && paddingBottom == bottom) {
      return
    }
    applyingInternalPadding = true
    super.setPadding(left, top, right, bottom)
    applyingInternalPadding = false
  }

  override fun setPadding(left: Int, top: Int, right: Int, bottom: Int) {
    if (applyingInternalPadding) {
      super.setPadding(left, top, right, bottom)
      return
    }
    styledPaddingLeft = left
    styledPaddingTop = top
    styledPaddingRight = right
    styledPaddingBottom = bottom
    applyCurrentPadding()
  }

  private inner class RuneInputConnection(
    target: InputConnection?,
    mutable: Boolean,
  ) : InputConnectionWrapper(target, mutable) {
    override fun setComposingText(text: CharSequence?, newCursorPosition: Int): Boolean {
      val result = super.setComposingText(text, newCursorPosition)
      if (!suppressNativeEvent && !text.isNullOrEmpty()) {
        updateCompositionState(true)
      }
      return result
    }

    override fun finishComposingText(): Boolean {
      val result = super.finishComposingText()
      if (!suppressNativeEvent) {
        updateCompositionState(false)
      }
      return result
    }
  }
}
