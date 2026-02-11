package dev.zynth.skia

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import org.json.JSONObject

class SkiaModule : ZynthModule, ZynthSyncModule {
  override val name: String = "Skia"

  override fun call(method: String, args: Array<Any?>): JSONObject {
    return callSync(method, args) as JSONObject
  }

  override fun callSync(method: String, args: Array<Any?>): Any {
    val payload = args.firstOrNull() as? JSONObject ?: JSONObject()
    return when (method) {
      "createSurface" -> createSurface(payload)
      "disposeSurface" -> disposeSurface(payload)
      "submitDrawCommands" -> submitDrawCommands(payload)
      "submitFrame" -> submitFrame(payload)
      "invalidateSurface" -> invalidateSurface(payload)
      "setFrameLoopEnabled" -> setFrameLoopEnabled(payload)
      else -> errorResult("unsupported_method", "Unsupported Skia method: $method")
    }
  }

  override fun invalidate() {
    SkiaBridge.clearRuntime()
  }

  private fun createSurface(payload: JSONObject): JSONObject {
    val nodeId = payload.optInt("nodeId", -1)
    if (nodeId <= 0) return errorResult("invalid_argument", "nodeId")
    return if (SkiaBridge.createSurface(nodeId)) okResult() else errorResult("surface_create_failed", "node=$nodeId")
  }

  private fun disposeSurface(payload: JSONObject): JSONObject {
    val nodeId = payload.optInt("nodeId", -1)
    if (nodeId <= 0) return errorResult("invalid_argument", "nodeId")
    return if (SkiaBridge.disposeSurface(nodeId)) okResult() else errorResult("surface_dispose_failed", "node=$nodeId")
  }

  private fun submitDrawCommands(payload: JSONObject): JSONObject {
    val nodeId = payload.optInt("nodeId", -1)
    if (nodeId <= 0) return errorResult("invalid_argument", "nodeId")

    val commands = payload.optJSONArray("commands")
      ?: return errorResult("invalid_argument", "commands")

    return if (SkiaBridge.submitCommands(nodeId, commands)) {
      okResult()
    } else {
      errorResult("submit_failed", "node=$nodeId")
    }
  }

  private fun submitFrame(payload: JSONObject): JSONObject {
    val nodeId = payload.optInt("nodeId", -1)
    if (nodeId <= 0) return errorResult("invalid_argument", "nodeId")

    val frame = payload.optJSONObject("frame")
      ?: return errorResult("invalid_argument", "frame")

    return if (SkiaBridge.submitFrame(nodeId, frame)) {
      okResult()
    } else {
      errorResult("submit_failed", "node=$nodeId")
    }
  }

  private fun invalidateSurface(payload: JSONObject): JSONObject {
    val nodeId = payload.optInt("nodeId", -1)
    if (nodeId <= 0) return errorResult("invalid_argument", "nodeId")
    return if (SkiaBridge.invalidateSurface(nodeId)) okResult() else errorResult("surface_not_found", "node=$nodeId")
  }

  private fun setFrameLoopEnabled(payload: JSONObject): JSONObject {
    val nodeId = payload.optInt("nodeId", -1)
    if (nodeId <= 0) return errorResult("invalid_argument", "nodeId")

    val enabled = payload.optBoolean("enabled", false)
    return if (SkiaBridge.setFrameLoopEnabled(nodeId, enabled)) {
      okResult()
    } else {
      errorResult("surface_not_found", "node=$nodeId")
    }
  }

  private fun okResult(): JSONObject {
    return JSONObject().put("result", true)
  }

  private fun errorResult(code: String, message: String): JSONObject {
    return JSONObject()
      .put("error", code)
      .put("message", message)
  }
}
