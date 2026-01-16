val reactNativeVersion = "0.84.0-rc.1"
val hermesVersion = "250829098.0.6"
val yogaVersion = "3.2.1"

plugins {
  id("com.android.library")
  id("org.jetbrains.kotlin.android")
}


android {
  namespace = "com.zynth.kit"
  compileSdk = 34

  defaultConfig {
    minSdk = 24
    targetSdk = 34
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    consumerProguardFiles("consumer-rules.pro")
    externalNativeBuild {
      cmake {
        cppFlags("-fexceptions", "-frtti", "-std=c++17", "-DLOG_TAG=\\\"ZynthKit\\\"")
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
      buildConfigField("boolean", "ZYNTH_USE_HBC", "true")
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
    getByName("debug") {
      isJniDebuggable = true
      buildConfigField("boolean", "ZYNTH_USE_HBC", "false")
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

  testOptions {
    unitTests.isIncludeAndroidResources = true
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
  implementation("androidx.appcompat:appcompat:1.6.1")
  implementation("com.google.android.material:material:1.11.0")

  implementation(kotlin("stdlib"))

  implementation("com.facebook.hermes:hermes-android:$hermesVersion")
  compileOnly("com.facebook.react:react-android:$reactNativeVersion")
  implementation("com.facebook.yoga:yoga:$yogaVersion")
  implementation("com.facebook.soloader:soloader:0.10.5")
  implementation("com.squareup.okhttp3:okhttp:4.11.0")

  testImplementation("junit:junit:4.13.2")
  testImplementation("org.robolectric:robolectric:4.11.1")
  testImplementation("androidx.test:core:1.5.0")
}
