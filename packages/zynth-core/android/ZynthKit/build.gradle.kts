val hermesVersion = "250829098.0.6"

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

  sourceSets {
    getByName("main") {
      jniLibs.srcDirs("../../native/vendor/android")
    }
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
      pickFirsts += setOf(
        "**/libc++_shared.so",
        "**/libhermes.so",
        "**/libhermesvm.so",
        "**/libjsi.so"
      )
      excludes += setOf(
        // fbjni is already provided as a transitive runtime dependency.
        // Excluding it here avoids shipping the same .so from both ZynthKit and fbjni.
        "**/libfbjni.so"
      )
    }
  }
}

dependencies {
  implementation("com.facebook.soloader:soloader:0.11.0")
  implementation("androidx.core:core-ktx:1.15.0")
  implementation("androidx.activity:activity-ktx:1.9.3")
  implementation("androidx.appcompat:appcompat:1.7.0")
  implementation("com.facebook.hermes:hermes-android:$hermesVersion")
  implementation("com.facebook.fbjni:fbjni:0.6.0")
  compileOnly("com.facebook.react:react-android:0.84.0-rc.1")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
