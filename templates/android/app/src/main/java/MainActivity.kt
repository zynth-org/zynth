package {{BUNDLE_ID}}

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.rune.kit.core.RuneRootView
import com.rune.kit.runtime.RhinoAdapter
import com.rune.kit.runtime.RuneRuntime

class MainActivity : AppCompatActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // Initialize SoLoader for Yoga layout engine
    RuneRuntime.initialize(this)

    val root = RuneRootView(this)
    setContentView(root)

    val runtime = RuneRuntime(root, RhinoAdapter())
    val code = assets.open("main.js").bufferedReader().use { it.readText() }
    runtime.load(code)
    runtime.start(root.rootId)
  }
}
