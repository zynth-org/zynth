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
  compileSdk = 34

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
          "-DZYNTH_LAYOUT_ENGINE=$layoutEngineName",
          "-DYOGA_BINARIES_DIR=${layout.buildDirectory.dir("yoga-ready").get().asFile.absolutePath}"
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
      jniLibs.srcDirs(layout.buildDirectory.dir("yoga-ready/libs"))
    }
  }
}

val fetchYogaBinaries by tasks.registering {
  val outputDir = layout.buildDirectory.dir("yoga-downloads")
  outputs.dir(outputDir)
  doLast {
    val downloadDir = outputDir.get().asFile
    if (!downloadDir.exists()) downloadDir.mkdirs()

    val abiMap = mapOf(
      "arm64-v8a" to "arm-64",
      "armeabi-v7a" to "arm-v7",
      "x86_64" to "arm-x64",
      "x86" to "arm-x86"
    )

    // Download headers
    val headerFile = file("${downloadDir.absolutePath}/headers.tar.gz")
    if (!headerFile.exists()) {
      println("◆ Downloading Yoga headers v$yogaVersion...")
      URI("$yogaBaseUrl/yoga-headers-v$yogaVersion.tar.gz").toURL().openStream().use { input ->
        headerFile.outputStream().use { output -> input.copyTo(output) }
      }
    }

    // Download binaries for each ABI
    abiMap.forEach { (abi, assetSuffix) ->
      val dest = file("${downloadDir.absolutePath}/$abi.tar.gz")
      if (!dest.exists()) {
        println("◆ Downloading Yoga binary for $abi...")
        URI("$yogaBaseUrl/yoga-android-$assetSuffix-v$yogaVersion.tar.gz").toURL().openStream().use { input ->
          dest.outputStream().use { output -> input.copyTo(output) }
        }
      }
    }
  }
}

val extractYogaBinaries by tasks.registering {
  dependsOn(fetchYogaBinaries)
  val downloadDir = layout.buildDirectory.dir("yoga-downloads").get().asFile
  val readyDir = layout.buildDirectory.dir("yoga-ready").get().asFile
  outputs.dir(readyDir)
  
  doLast {
    val abiList = listOf("arm64-v8a", "armeabi-v7a", "x86_64", "x86")
    
    // Extract headers
    copy {
      from(tarTree(resources.gzip(file("${downloadDir.absolutePath}/headers.tar.gz"))))
      into(file("${readyDir.absolutePath}/headers/yoga"))
    }

    // Extract each ABI
    abiList.forEach { abi ->
      copy {
        from(tarTree(resources.gzip(file("${downloadDir.absolutePath}/$abi.tar.gz"))))
        into(file("${readyDir.absolutePath}/libs/$abi"))
      }
    }
  }
}

tasks.matching { task ->
  task.name.startsWith("configureCMake") || 
  task.name.startsWith("buildCMake") ||
  (task.name.startsWith("merge") && task.name.endsWith("JniLibFolders"))
}.configureEach {
  dependsOn(extractYogaBinaries)
}

dependencies {
  implementation("androidx.core:core-ktx:1.12.0")
  implementation("com.facebook.hermes:hermes-android:$hermesVersion")
  implementation("com.facebook.soloader:soloader:0.10.5")
  compileOnly("com.facebook.react:react-android:$reactNativeVersion")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  // Using custom Yoga binaries instead of Maven dependency
}
