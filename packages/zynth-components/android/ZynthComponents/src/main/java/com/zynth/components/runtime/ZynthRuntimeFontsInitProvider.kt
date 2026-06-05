package com.zynth.components.runtime

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.util.Log
import com.zynth.kit.runtime.FontRegistry

class ZynthRuntimeFontsInitProvider : ContentProvider() {
  override fun onCreate(): Boolean {
    val context = context ?: return true

    try {
      FontRegistry.initialize(context.applicationContext)
      val fontFiles = context.assets.list("fonts").orEmpty()
      for (fileName in fontFiles) {
        if (!fileName.endsWith(".ttf")) continue
        if (!fileName.startsWith("ZynthRuntime")) continue
        val family = fileName.removeSuffix(".ttf")
        FontRegistry.loadFont(family, fileName)
      }
    } catch (error: Throwable) {
      Log.w("ZynthRuntimeFonts", "Failed to pre-register runtime fonts", error)
    }

    return true
  }

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?,
  ): Cursor? = null

  override fun getType(uri: Uri): String? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

  override fun update(
    uri: Uri,
    values: ContentValues?,
    selection: String?,
    selectionArgs: Array<out String>?,
  ): Int = 0
}
