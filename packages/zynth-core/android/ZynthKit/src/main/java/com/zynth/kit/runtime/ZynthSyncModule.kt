package com.zynth.kit.runtime

interface ZynthSyncModule {
  fun callSync(method: String, args: Array<Any?>): Any?
}
