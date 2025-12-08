package com.rune.components.datepicker

import android.content.Context
import android.content.ContextWrapper
import android.view.View
import android.widget.FrameLayout
import androidx.core.util.Pair
import androidx.fragment.app.FragmentActivity
import com.google.android.material.datepicker.MaterialDatePicker
import com.rune.kit.core.RuneUIManager
import java.util.Calendar
import java.util.TimeZone
import org.json.JSONObject

class RuneDatePickerView(context: Context) : FrameLayout(context) {
  var manager: RuneUIManager? = null
  var nodeId: Int = -1
  var hasOnChangeHandler = false
  var hasOnRangeHandler = false
  var hasOnCancelHandler = false
  var hasOnDismissHandler = false

  var mode: String = "date"
  private var selection: Long? = null
  private var rangeSelection: Pair<Long, Long>? = null
  private var titleText: String? = null
  private var confirmText: String? = null
  private var cancelText: String? = null
  private var triggerView: RuneDatePickerTriggerView? = null
  private var activePicker: MaterialDatePicker<*>? = null

  init {
    clipChildren = false
    clipToPadding = false
  }

  override fun onViewAdded(child: View) {
    super.onViewAdded(child)
    if (child is RuneDatePickerTriggerView) {
      attachTrigger(child)
    }
  }

  override fun onViewRemoved(child: View) {
    super.onViewRemoved(child)
    if (child === triggerView) {
      triggerView?.datePickerView = null
      triggerView = null
    }
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    activePicker?.dismiss()
    activePicker = null
  }

  fun setSelection(value: Long?) {
    selection = value
  }

  fun setRangeSelection(start: Long?, end: Long?) {
    rangeSelection = if (start != null && end != null) {
      Pair(start, end)
    } else {
      null
    }
  }

  fun setTitleText(value: String?) {
    titleText = value
  }

  fun setConfirmText(value: String?) {
    confirmText = value
  }

  fun setCancelText(value: String?) {
    cancelText = value
  }

  fun showPicker() {
    val activity = findFragmentActivity(context) ?: return
    val fragmentManager = activity.supportFragmentManager
    if (fragmentManager.isStateSaved) return
    if (activePicker?.isAdded == true) return

    val tag = "rune_date_picker_$nodeId"
    if (fragmentManager.findFragmentByTag(tag) != null) return

    val normalizedMode = mode.lowercase()

    if (normalizedMode == "range") {
      val builder = MaterialDatePicker.Builder.dateRangePicker()
      builder.setTheme(com.google.android.material.R.style.ThemeOverlay_Material3_MaterialCalendar)
      titleText?.let { builder.setTitleText(it) }
      rangeSelection?.let { builder.setSelection(it) }
      if (!confirmText.isNullOrEmpty()) {
        builder.setPositiveButtonText(confirmText)
      }
      if (!cancelText.isNullOrEmpty()) {
        builder.setNegativeButtonText(cancelText)
      }

      val picker = builder.build()
      picker.addOnPositiveButtonClickListener { value ->
        val start = value?.first
        val end = value?.second
        if (start != null && end != null) {
          rangeSelection = Pair(start, end)
        } else {
          rangeSelection = null
        }
        if (hasOnRangeHandler) {
          val payload = JSONObject()
          payload.put("start", start ?: JSONObject.NULL)
          payload.put("end", end ?: JSONObject.NULL)
          manager?.dispatchEvent(nodeId, "onRangeChange", payload)
        }
      }
      picker.addOnNegativeButtonClickListener {
        if (hasOnCancelHandler) {
          manager?.dispatchEvent(nodeId, "onCancel", JSONObject())
        }
      }
      picker.addOnCancelListener {
        if (hasOnCancelHandler) {
          manager?.dispatchEvent(nodeId, "onCancel", JSONObject())
        }
      }
      picker.addOnDismissListener {
        activePicker = null
        if (hasOnDismissHandler) {
          manager?.dispatchEvent(nodeId, "onDismiss", JSONObject())
        }
      }

      activePicker = picker
      picker.show(fragmentManager, tag)
    } else {
      val builder = MaterialDatePicker.Builder.datePicker()
      builder.setTheme(com.google.android.material.R.style.ThemeOverlay_Material3_MaterialCalendar)
      titleText?.let { builder.setTitleText(it) }
      selection?.let { builder.setSelection(it) }
      if (!confirmText.isNullOrEmpty()) {
        builder.setPositiveButtonText(confirmText)
      }
      if (!cancelText.isNullOrEmpty()) {
        builder.setNegativeButtonText(cancelText)
      }

      val picker = builder.build()
      picker.addOnPositiveButtonClickListener { value ->
        val nextValue = if (normalizedMode == "year") {
          normalizeToYearStartUtc(value)
        } else {
          value
        }
        selection = nextValue
        if (hasOnChangeHandler) {
          manager?.dispatchEvent(nodeId, "onChange", JSONObject().put("value", nextValue))
        }
      }
      picker.addOnNegativeButtonClickListener {
        if (hasOnCancelHandler) {
          manager?.dispatchEvent(nodeId, "onCancel", JSONObject())
        }
      }
      picker.addOnCancelListener {
        if (hasOnCancelHandler) {
          manager?.dispatchEvent(nodeId, "onCancel", JSONObject())
        }
      }
      picker.addOnDismissListener {
        activePicker = null
        if (hasOnDismissHandler) {
          manager?.dispatchEvent(nodeId, "onDismiss", JSONObject())
        }
      }

      activePicker = picker
      picker.show(fragmentManager, tag)
    }
  }

  fun handleCommand(commandJson: String?) {
    if (commandJson.isNullOrBlank()) return
    try {
      val command = JSONObject(commandJson)
      when (command.optString("type")) {
        "show" -> showPicker()
        "dismiss" -> dismissPicker()
      }
    } catch (_: Exception) {
    }
  }

  fun dismissPicker() {
    activePicker?.dismiss()
    activePicker = null
  }

  private fun attachTrigger(trigger: RuneDatePickerTriggerView) {
    if (triggerView === trigger) return
    triggerView?.datePickerView = null
    triggerView = trigger
    trigger.datePickerView = this
  }

  private fun findFragmentActivity(context: Context): FragmentActivity? {
    var current: Context? = context
    while (current is ContextWrapper) {
      if (current is FragmentActivity) return current
      current = current.baseContext
    }
    return current as? FragmentActivity
  }

  fun reset() {
    dismissPicker()
    triggerView?.datePickerView = null
    triggerView = null
    selection = null
    rangeSelection = null
    titleText = null
    confirmText = null
    cancelText = null
    mode = "date"
    hasOnChangeHandler = false
    hasOnRangeHandler = false
    hasOnCancelHandler = false
    hasOnDismissHandler = false
    manager = null
    nodeId = -1
  }

  private fun normalizeToYearStartUtc(value: Long): Long {
    val calendar = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
    calendar.timeInMillis = value
    calendar.set(Calendar.MONTH, Calendar.JANUARY)
    calendar.set(Calendar.DAY_OF_MONTH, 1)
    calendar.set(Calendar.HOUR_OF_DAY, 0)
    calendar.set(Calendar.MINUTE, 0)
    calendar.set(Calendar.SECOND, 0)
    calendar.set(Calendar.MILLISECOND, 0)
    return calendar.timeInMillis
  }
}
