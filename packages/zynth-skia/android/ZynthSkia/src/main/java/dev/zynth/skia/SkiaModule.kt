package dev.zynth.skia

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject

class SkiaModule : ZynthModule, ZynthSyncModule {
  override val name: String = "Skia"

  override val exportedMethods: List<String> = listOf(
    "createSurface",
    "disposeSurface",
    "submitDrawCommands",
    "submitFrame",
    "invalidateSurface",
    "setFrameLoopEnabled"
  )

  override fun call(method: String, args: ZynthArgs): JSONObject {
    return callSync(method, args) as JSONObject
  }

  override fun callSync(method: String, args: ZynthArgs): Any {
    val payload = try { JSONObject(args.asMap()) } catch (e: Exception) { JSONObject() }
    return when (method) {
      "createSurface" -> createSurface(payload)
      "disposeSurface" -> disposeSurface(payload)
      "submitDrawCommands" -> submitDrawCommands(payload)
      "submitFrame" -> submitFrame(payload)
      "invalidateSurface" -> invalidateSurface(payload)
      "setFrameLoopEnabled" -> setFrameLoopEnabled(payload)
      else -> throw IllegalArgumentException("Unsupported Skia method: $method")
    }
  }

  override fun invalidate() {
    SkiaBridge.clearRuntime()
  }

  private fun createSurface(payload: JSONObject): JSONObject {
    val nodeId = payload.optInt("nodeId", -1)
    if (nodeId <= 0) throw IllegalArgumentException("Missing or invalid nodeId")
    if (!SkiaBridge.createSurface(nodeId)) {
        throw IllegalStateException("Surface creation failed for node=$nodeId")
    }
    return resultResponse(true)
  }

  private fun disposeSurface(payload: JSONObject): JSONObject {
    val nodeId = payload.optInt("nodeId", -1)
    if (nodeId <= 0) throw IllegalArgumentException("Missing or invalid nodeId")
    SkiaBridge.disposeSurface(nodeId)
    return resultResponse(true)
  }

  private fun submitDrawCommands(payload: JSONObject): JSONObject {
    val nodeId = payload.optInt("nodeId", -1)
    if (nodeId <= 0) throw IllegalArgumentException("Missing or invalid nodeId")

    val commands = payload.optJSONArray("commands")
      ?: throw IllegalArgumentException("Missing commands")

    if (!SkiaBridge.submitCommands(nodeId, commands)) {
      throw IllegalStateException("Submit commands failed for node=$nodeId")
    }
    return resultResponse(true)
  }

  private fun submitFrame(payload: JSONObject): JSONObject {
    val nodeId = payload.optInt("nodeId", -1)
    if (nodeId <= 0) throw IllegalArgumentException("Missing or invalid nodeId")

    val frame = payload.optJSONObject("frame")
      ?: throw IllegalArgumentException("Missing frame")

    if (!SkiaBridge.submitFrame(nodeId, frame)) {
      throw IllegalStateException("Submit frame failed for node=$nodeId")
    }
    return resultResponse(true)
  }

  private fun invalidateSurface(payload: JSONObject): JSONObject {
    val nodeId = payload.optInt("nodeId", -1)
    if (nodeId <= 0) throw IllegalArgumentException("Missing or invalid nodeId")
    if (!SkiaBridge.invalidateSurface(nodeId)) {
        throw IllegalStateException("Surface not found for node=$nodeId")
    }
    return resultResponse(true)
  }

  private fun setFrameLoopEnabled(payload: JSONObject): JSONObject {
    val nodeId = payload.optInt("nodeId", -1)
    if (nodeId <= 0) throw IllegalArgumentException("Missing or invalid nodeId")

    val enabled = payload.optBoolean("enabled", false)
    if (!SkiaBridge.setFrameLoopEnabled(nodeId, enabled)) {
      throw IllegalStateException("Surface not found for node=$nodeId")
    }
    return resultResponse(true)
  }

  private fun resultResponse(result: Any?): JSONObject {
    return JSONObject().put("result", result)
  }
}
