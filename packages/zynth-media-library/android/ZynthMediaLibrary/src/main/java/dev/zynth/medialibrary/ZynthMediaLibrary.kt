package dev.zynth.medialibrary

import androidx.activity.ComponentActivity
import com.zynth.kit.runtime.ZynthRuntime

object ZynthMediaLibrary {
    @JvmStatic
    fun initialize(activity: ComponentActivity, runtime: ZynthRuntime) {
        runtime.installModules(listOf(MediaLibraryModule(activity)))
    }
}
