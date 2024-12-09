val reactNativeVersion = "0.74.3"

plugins {
  id("com.android.library")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "com.rune.kit"
  compileSdk = 34

  defaultConfig {
    minSdk = 24
    targetSdk = 34
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    consumerProguardFiles("consumer-rules.pro")
    externalNativeBuild {
      cmake {
        cppFlags("-fexceptions", "-frtti", "-std=c++17", "-DLOG_TAG=\\\"RuneKit\\\"")
        arguments("-DANDROID_STL=c++_shared")
      }
    }
    ndk {
      abiFilters += listOf("arm64-v8a", "x86_64")
    }
  }

  buildTypes {
    getByName("release") {
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
    getByName("debug") {
      isJniDebuggable = true
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
    resources.excludes += setOf("**/*.md", "**/*.txt")
    jniLibs {
      excludes += setOf(
        "**/libc++_shared.so",
        "**/libhermes.so",
        "**/libhermes-executor-debug.so",
        "**/libhermes-executor-release.so",
        "**/libjsi.so"
      )
    }
  }
}

dependencies {
  implementation("androidx.core:core-ktx:1.12.0")
  implementation("androidx.appcompat:appcompat:1.6.1")
  implementation("com.google.android.material:material:1.11.0")

  implementation(kotlin("stdlib"))

  implementation("com.facebook.react:hermes-android:$reactNativeVersion")
  implementation("com.facebook.react:react-android:$reactNativeVersion")
  implementation("com.facebook.soloader:soloader:0.10.5")
  implementation("org.mozilla:rhino:1.7.14")
  implementation("com.squareup.okhttp3:okhttp:4.11.0")
}
