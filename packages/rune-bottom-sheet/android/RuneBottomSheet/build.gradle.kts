plugins {
  id("com.android.library")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "com.rune.bottomsheet"
  compileSdk = 34

  defaultConfig {
    minSdk = 24
    targetSdk = 34
    consumerProguardFiles("consumer-rules.pro")
  }

  buildTypes {
    getByName("release") {
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
    getByName("debug") {
      // Defaults are sufficient for now
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions {
    jvmTarget = "17"
  }

  packaging {
    resources.excludes += setOf("**/*.md", "**/*.txt")
  }
}

dependencies {
  implementation(project(":RuneKit"))
  implementation("androidx.core:core-ktx:1.12.0")
  implementation("androidx.coordinatorlayout:coordinatorlayout:1.2.0")
  implementation("com.google.android.material:material:1.11.0")
}
