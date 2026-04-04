import com.android.build.api.attributes.BuildTypeAttr
import org.gradle.api.attributes.Bundling
import org.gradle.api.attributes.Category
import org.gradle.api.attributes.LibraryElements
import org.gradle.api.attributes.Usage

val reactNativeVersion = "0.84.0-rc.1"
val hermesVersion = "250829098.0.6"
val yogaVersion = "3.2.1"
val axonEnabled =
  (providers.gradleProperty("zynthAxonEnabled").orNull ?: "false").toBoolean()
val layoutEngineName = if (axonEnabled) "AXON" else "YOGA"
val yogaRuntime by configurations.creating {
  isCanBeConsumed = false
  isCanBeResolved = true
  isTransitive = false
  attributes {
    attribute(Category.CATEGORY_ATTRIBUTE, objects.named(Category.LIBRARY))
    attribute(Bundling.BUNDLING_ATTRIBUTE, objects.named(Bundling.EXTERNAL))
    attribute(LibraryElements.LIBRARY_ELEMENTS_ATTRIBUTE, objects.named("aar"))
    attribute(Usage.USAGE_ATTRIBUTE, objects.named(Usage.JAVA_RUNTIME))
    attribute(BuildTypeAttr.ATTRIBUTE, objects.named("release"))
  }
}

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
        "**/libfbjni.so"
      )
    }
  }
}

val extractYogaRuntime by tasks.registering(Sync::class) {
  onlyIf { !axonEnabled }
  from(yogaRuntime.elements.map { files ->
    files.map { zipTree(it.asFile) }
  })
  into(layout.buildDirectory.dir("yoga-extracted"))
}

tasks.matching { task ->
  task.name.startsWith("configureCMake") || task.name.startsWith("buildCMake")
}.configureEach {
  dependsOn(extractYogaRuntime)
}

dependencies {
  implementation("androidx.core:core-ktx:1.12.0")
  implementation("com.facebook.hermes:hermes-android:$hermesVersion")
  implementation("com.facebook.soloader:soloader:0.10.5")
  compileOnly("com.facebook.react:react-android:$reactNativeVersion")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  if (!axonEnabled) {
    add("yogaRuntime", "com.facebook.yoga:yoga:$yogaVersion")
  }
}

// Force rebuild of ZynthKit - gemini-fix-font-loading
