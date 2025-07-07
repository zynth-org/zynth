package {{BUNDLE_ID}}

import android.app.Application
import com.google.android.material.color.DynamicColors

class MainApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Apply Material 3 dynamic colors based on wallpaper (Android 12+)
        DynamicColors.applyToActivitiesIfAvailable(this)
    }
}
