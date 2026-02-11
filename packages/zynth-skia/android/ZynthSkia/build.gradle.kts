plugins {
  id("com.android.library")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "dev.zynth.skia"
  compileSdk = 34

  defaultConfig {
    minSdk = 24
    targetSdk = 34
    ndk {
      abiFilters += listOf("arm64-v8a", "x86", "x86_64")
    }
    externalNativeBuild {
      cmake {
        cppFlags("-fexceptions", "-frtti", "-std=c++17")
        arguments("-DANDROID_STL=c++_shared")
      }
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = false
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
        "**/libfbjni.so",
      )
    }
  }
}

dependencies {
  implementation(project(":ZynthKit"))
  implementation("androidx.core:core-ktx:1.12.0")
  compileOnly("com.facebook.react:react-android:0.84.0-rc.1")
}
