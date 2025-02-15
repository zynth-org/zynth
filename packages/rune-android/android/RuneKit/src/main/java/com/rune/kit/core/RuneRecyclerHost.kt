package com.rune.kit.core

import org.json.JSONArray
import org.json.JSONObject

internal class RuneRecyclerHost {
  private data class Template(
    val id: String,
    var descriptor: JSONObject? = null,
    val operations: MutableList<JSONObject> = mutableListOf(),
  )

  private val templates = mutableMapOf<String, Template>()

  fun onBatch(meta: JSONObject?, operations: JSONArray) {
    if (meta == null) return
    val kind = meta.optString("kind", meta.optString("scope", ""))
    if (kind.isBlank()) return
    when (kind) {
      "template" -> registerTemplate(meta, operations)
      "hydrate", "update" -> updateTemplate(meta, operations)
      else -> {
        // Future kinds can be handled here.
      }
    }
  }

  private fun registerTemplate(meta: JSONObject, operations: JSONArray) {
    val templateId = meta.optString("templateId")
    if (templateId.isBlank()) return
    val descriptor = meta.optJSONObject("descriptor")
    val template = templates.getOrPut(templateId) { Template(templateId) }
    template.descriptor = descriptor?.let { JSONObject(it.toString()) }
    template.operations.clear()
    appendOperations(template, operations)
  }

  private fun updateTemplate(meta: JSONObject, operations: JSONArray) {
    val templateId = meta.optString("templateId")
    if (templateId.isBlank()) return
    val template = templates[templateId] ?: return
    if (operations.length() == 0) return
    appendOperations(template, operations)
  }

  private fun appendOperations(template: Template, operations: JSONArray) {
    for (i in 0 until operations.length()) {
      val op = operations.optJSONObject(i) ?: continue
      template.operations.add(JSONObject(op.toString()))
    }
  }

  fun snapshotTemplate(id: String): List<JSONObject>? {
    return templates[id]?.operations?.map { JSONObject(it.toString()) }
  }

  fun templateDescriptor(id: String): JSONObject? {
    val descriptor = templates[id]?.descriptor ?: return null
    return JSONObject(descriptor.toString())
  }
}
