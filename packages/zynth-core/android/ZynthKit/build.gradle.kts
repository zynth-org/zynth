val reactNativeVersion = "0.84.0-rc.1"
val hermesVersion = "250829098.0.6"

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
    externalNativeBuild {
      cmake {
        cppFlags("-fexceptions", "-frtti", "-std=c++17")
        arguments("-DANDROID_STL=c++_shared")
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

dependencies {
  implementation("androidx.core:core-ktx:1.12.0")
  implementation("com.facebook.hermes:hermes-android:$hermesVersion")
  implementation("com.facebook.soloader:soloader:0.10.5")
  compileOnly("com.facebook.react:react-android:$reactNativeVersion")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
}

// Force rebuild of ZynthKit - gemini-fix-font-loading
