package dev.zynth.skia

import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import com.zynth.kit.runtime.ZynthRuntime
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference

object SkiaBridge {
  private const val OPCODE_CLEAR = 1.0
  private const val OPCODE_RECT = 2.0
  private const val OPCODE_CIRCLE = 3.0
  private const val OPCODE_LINE = 4.0

  private const val COLOR_TYPE_INT = 1.0
  private const val COLOR_TYPE_STRING = 2.0

  private const val STYLE_FILL = 0.0
  private const val STYLE_STROKE = 1.0

  private val mainHandler = Handler(Looper.getMainLooper())
  private var runtimeRef: WeakReference<ZynthRuntime>? = null

  @JvmStatic
  fun installRuntime(runtime: ZynthRuntime) {
    runtimeRef = WeakReference(runtime)
  }

  @JvmStatic
  fun clearRuntime() {
    runtimeRef = null
  }

  @JvmStatic
  fun createSurface(nodeId: Int): Boolean {
    if (nodeId <= 0) return false
    val created = nativeCreateSurface(nodeId)
    if (!created) return false

    runOnMainAsync {
      val view = currentRuntime()?.getUIManager()?.getNodeView(nodeId) as? SkiaView
      if (view != null) {
        view.setSurfaceAvailable(true)
        view.markSurfaceDirty()
      }
    }
    return true
  }

  @JvmStatic
  fun disposeSurface(nodeId: Int): Boolean {
    if (nodeId <= 0) return false
    val disposed = nativeDisposeSurface(nodeId)
    if (!disposed) return false

    runOnMainAsync {
      (currentRuntime()?.getUIManager()?.getNodeView(nodeId) as? SkiaView)?.setSurfaceAvailable(false)
    }
    return true
  }

  @JvmStatic
  fun submitDrawCommandsPacked(
    nodeId: Int,
    ops: DoubleArray,
    opCount: Int,
    stringTable: Array<String?>,
  ): Boolean {
    if (nodeId <= 0) return false
    val boundedCount = opCount.coerceAtLeast(0).coerceAtMost(ops.size)

    val accepted = nativeSubmitDrawCommandsPacked(
      nodeId,
      if (boundedCount == ops.size) ops else ops.copyOfRange(0, boundedCount),
      boundedCount,
      stringTable,
    )
    if (!accepted) return false

    runOnMainAsync {
      (currentRuntime()?.getUIManager()?.getNodeView(nodeId) as? SkiaView)?.markSurfaceDirty()
    }
    return true
  }

  @JvmStatic
  fun submitCommands(nodeId: Int, commands: JSONArray): Boolean {
    val encoded = encodeCommands(commands)
    return submitDrawCommandsPacked(nodeId, encoded.ops, encoded.opCount, encoded.stringTable)
  }

  @JvmStatic
  fun submitFrame(nodeId: Int, frame: JSONObject): Boolean {
    val commands = frame.optJSONArray("commands") ?: return false
    return submitCommands(nodeId, commands)
  }

  @JvmStatic
  fun invalidateSurface(nodeId: Int): Boolean {
    if (nodeId <= 0) return false
    val invalidated = nativeInvalidateSurface(nodeId)
    if (!invalidated) return false
    runOnMainAsync {
      (currentRuntime()?.getUIManager()?.getNodeView(nodeId) as? SkiaView)?.markSurfaceDirty()
    }
    return true
  }

  @JvmStatic
  fun setFrameLoopEnabled(nodeId: Int, enabled: Boolean): Boolean {
    if (nodeId <= 0) return false
    val updated = nativeSetFrameLoopEnabled(nodeId, enabled)
    if (!updated) return false
    runOnMainAsync {
      (currentRuntime()?.getUIManager()?.getNodeView(nodeId) as? SkiaView)?.setFrameLoopEnabled(enabled)
    }
    return true
  }

  @JvmStatic
  fun renderToBitmap(
    nodeId: Int,
    width: Int,
    height: Int,
    clearColor: Int,
    density: Float,
    bitmap: Bitmap,
  ): Boolean {
    if (nodeId <= 0 || width <= 0 || height <= 0) return false
    return nativeRenderToBitmap(nodeId, width, height, clearColor, density, bitmap)
  }

  @JvmStatic
  fun hasSurface(nodeId: Int): Boolean {
    if (nodeId <= 0) return false
    return nativeHasSurface(nodeId)
  }

  private data class EncodedCommands(
    val ops: DoubleArray,
    val opCount: Int,
    val stringTable: Array<String?>,
  )

  private fun encodeCommands(commands: JSONArray): EncodedCommands {
    val encoded = ArrayList<Double>(commands.length() * 10)
    val stringTable = ArrayList<String>()
    val stringIndex = HashMap<String, Int>()

    fun addString(value: String): Int {
      val existing = stringIndex[value]
      if (existing != null) return existing
      val next = stringTable.size
      stringTable.add(value)
      stringIndex[value] = next
      return next
    }

    fun pushColor(raw: String?) {
      val value = raw?.trim().orEmpty()
      val parsed = parsePackedColor(value)
      if (parsed != null) {
        encoded.add(COLOR_TYPE_INT)
        encoded.add(parsed.toDouble())
      } else {
        val idx = addString(value)
        encoded.add(COLOR_TYPE_STRING)
        encoded.add(idx.toDouble())
      }
    }

    for (i in 0 until commands.length()) {
      val command = commands.optJSONObject(i) ?: continue
      when (command.optString("type", "")) {
        "clear" -> {
          encoded.add(OPCODE_CLEAR)
          pushColor(command.optString("color", ""))
        }
        "rect" -> {
          encoded.add(OPCODE_RECT)
          encoded.add(command.optDouble("x", 0.0))
          encoded.add(command.optDouble("y", 0.0))
          encoded.add(command.optDouble("width", 0.0))
          encoded.add(command.optDouble("height", 0.0))
          pushColor(command.optString("color", ""))
          encoded.add(command.optDouble("strokeWidth", 1.0))
          encoded.add(if (command.optString("style", "fill") == "stroke") STYLE_STROKE else STYLE_FILL)
        }
        "circle" -> {
          encoded.add(OPCODE_CIRCLE)
          encoded.add(command.optDouble("cx", 0.0))
          encoded.add(command.optDouble("cy", 0.0))
          encoded.add(command.optDouble("r", 0.0))
          pushColor(command.optString("color", ""))
          encoded.add(command.optDouble("strokeWidth", 1.0))
          encoded.add(if (command.optString("style", "fill") == "stroke") STYLE_STROKE else STYLE_FILL)
        }
        "line" -> {
          encoded.add(OPCODE_LINE)
          encoded.add(command.optDouble("x1", 0.0))
          encoded.add(command.optDouble("y1", 0.0))
          encoded.add(command.optDouble("x2", 0.0))
          encoded.add(command.optDouble("y2", 0.0))
          pushColor(command.optString("color", ""))
          encoded.add(command.optDouble("strokeWidth", 1.0))
        }
      }
    }

    return EncodedCommands(
      ops = encoded.toDoubleArray(),
      opCount = encoded.size,
      stringTable = stringTable.toTypedArray(),
    )
  }

  private fun parsePackedColor(value: String): Int? {
    if (!value.startsWith("#")) return null
    val hex = value.substring(1)
    if (hex.length != 6 && hex.length != 8) return null
    val parsed = hex.toLongOrNull(16) ?: return null
    return if (hex.length == 6) {
      (0xFF000000L or parsed).toInt()
    } else {
      parsed.toInt()
    }
  }

  private fun currentRuntime(): ZynthRuntime? = runtimeRef?.get()

  private fun runOnMainAsync(block: () -> Unit) {
    if (currentRuntime() == null) return
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
      return
    }
    mainHandler.post(block)
  }

  private external fun nativeCreateSurface(nodeId: Int): Boolean
  private external fun nativeDisposeSurface(nodeId: Int): Boolean
  private external fun nativeSubmitDrawCommandsPacked(
    nodeId: Int,
    ops: DoubleArray,
    opCount: Int,
    stringTable: Array<String?>,
  ): Boolean
  private external fun nativeInvalidateSurface(nodeId: Int): Boolean
  private external fun nativeSetFrameLoopEnabled(nodeId: Int, enabled: Boolean): Boolean
  private external fun nativeRenderToBitmap(
    nodeId: Int,
    width: Int,
    height: Int,
    clearColor: Int,
    density: Float,
    bitmap: Bitmap,
  ): Boolean
  private external fun nativeHasSurface(nodeId: Int): Boolean
}
