plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "{{BUNDLE_ID}}"
  compileSdk = 34

  defaultConfig {
    applicationId = "{{BUNDLE_ID}}"
    minSdk = 24
    targetSdk = 34
    versionCode = 1
    versionName = "1.0"
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions {
    jvmTarget = "17"
  }
}

dependencies {
  implementation(project(":RuneKit"))
  implementation("androidx.core:core-ktx:1.12.0")
  implementation("androidx.core:core-splashscreen:1.0.1")
  implementation("androidx.appcompat:appcompat:1.6.1")
  implementation("com.google.android.material:material:1.11.0")
{{RUNE_COMPONENT_MODULE_DEPENDENCIES}}
}
