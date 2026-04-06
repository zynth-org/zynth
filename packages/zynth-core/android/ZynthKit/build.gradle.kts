import com.android.build.api.attributes.BuildTypeAttr
import org.gradle.api.attributes.Bundling
import org.gradle.api.attributes.Category
import org.gradle.api.attributes.LibraryElements
import org.gradle.api.attributes.Usage
import java.net.URI
import java.io.InputStream

val reactNativeVersion = "0.84.0-rc.1"
val hermesVersion = "250829098.0.6"
val yogaVersion = "3.2.1"
val yogaBaseUrl = "https://github.com/x64Bits/skia-assets/releases/download/yoga-v$yogaVersion"

val axonEnabled =
  (providers.gradleProperty("zynthAxonEnabled").orNull ?: "false").toBoolean()
val layoutEngineName = if (axonEnabled) "AXON" else "YOGA"
// Removed yogaRuntime configuration as we are using custom binaries

plugins {
  id("com.android.library")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "com.zynth.kit"
  compileSdk = 35

  defaultConfig {
    minSdk = 24
    consumerProguardFiles("consumer-rules.pro")
    buildConfigField("boolean", "ZYNTH_AXON_ENABLED", axonEnabled.toString())
    buildConfigField("String", "ZYNTH_LAYOUT_ENGINE", "\"$layoutEngineName\"")
    buildConfigField("boolean", "ZYNTH_LAYOUT_DEBUG_LOGS", "false")
    buildConfigField("boolean", "ZYNTH_LAYOUT_DEBUG_METRICS", "false")
    externalNativeBuild {
      cmake {
        cppFlags("-fexceptions", "-frtti", "-std=c++17")
        arguments(
          "-DANDROID_STL=c++_shared",
          "-DZYNTH_AXON_ENABLED=${if (axonEnabled) "ON" else "OFF"}",
          "-DZYNTH_LAYOUT_ENGINE=$layoutEngineName"
        )
      }
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions {
    jvmTarget = "17"
  }

  buildFeatures {
    prefab = true
    buildConfig = true
  }

  externalNativeBuild {
    cmake {
      path = file("CMakeLists.txt")
    }
  }

  packaging {
    jniLibs {
      excludes += setOf(
        "**/libc++_shared.so",
        "**/libhermes.so",
        "**/libhermesvm.so",
        "**/libhermes-executor-debug.so",
        "**/libhermes-executor-release.so",
        "**/libfbjni.so",
        "**/libreactnative.so",
        "**/libyoga.so"
      )
    }
  }

  sourceSets {
    getByName("main") {
      jniLibs.srcDirs("../../native/vendor/yoga/android")
    }
  }
}

val syncYogaBinaries by tasks.registering(Exec::class) {
  workingDir = projectDir.parentFile.parentFile // packages/zynth-core
  executable = "npm"
  args("run", "sync:yoga")
}

tasks.matching { task ->
  task.name.startsWith("configureCMake") || 
  task.name.startsWith("buildCMake") ||
  (task.name.startsWith("merge") && task.name.endsWith("JniLibFolders"))
}.configureEach {
  dependsOn(syncYogaBinaries)
}

dependencies {
  implementation("androidx.core:core-ktx:1.15.0")
  implementation("androidx.activity:activity-ktx:1.9.3")
  implementation("androidx.appcompat:appcompat:1.7.0")
  implementation("com.facebook.hermes:hermes-android:$hermesVersion")
  implementation("com.facebook.soloader:soloader:0.10.5")
  compileOnly("com.facebook.react:react-android:$reactNativeVersion")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  // Using custom Yoga binaries instead of Maven dependency
}
