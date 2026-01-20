package com.zynth.kit.core

class ZynthUIManager {
  private var nextId = 1

  fun createNode(type: String): Int {
    type.length
    return nextId++
  }

  fun setProp(id: Int, name: String, jsonValue: String?) {
    id
    name.length
    jsonValue?.length
  }

  fun setText(id: Int, text: String) {
    id
    text.length
  }

  fun insertChild(parentId: Int, childId: Int, index: Int) {
    parentId
    childId
    index
  }

  fun removeChild(parentId: Int, childId: Int) {
    parentId
    childId
  }

  fun setHandler(id: Int, name: String, handlerId: Long) {
    id
    name.length
    handlerId
  }

  fun applyBatch(json: String) {
    json.length
  }

  fun setSurface(surfaceId: Int) {
    surfaceId
  }

  fun flush() {
  }
}
