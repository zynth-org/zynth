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

  packaging {
    jniLibs {
      excludes += setOf(
        "**/libfabricjni.so",
        "**/libreactnativejni.so",
        "**/libreact_codegen_*.so",
        "**/libreact_newarchdefaults.so",
        "**/librrc_*.so",
        "**/libuimanagerjni.so",
        "**/libreact_render_*.so",
        "**/librninstance.so",
        "**/libreact_nativemodule_core.so",
        "**/libnative-imagetranscoder.so",
        "**/libimagepipeline.so",
        "**/libnative-filters.so",
        "**/libturbomodulejsijni.so",
        "**/libreact_devsupportjni.so",
        "**/libreact_featureflags*.so",
        "**/libmapbufferjni.so",
        "**/libhermes_executor.so",
        "**/libhermesinstancejni.so",
        "**/libjscexecutor.so",
        "**/libjscinstance.so",
        "**/libreactnativeblob.so"
      )
    }
  }
}

dependencies {
  implementation(project(":ZynthKit"))
  implementation("androidx.core:core-ktx:1.12.0")
  implementation("androidx.core:core-splashscreen:1.0.1")
  implementation("androidx.appcompat:appcompat:1.6.1")
  implementation("com.google.android.material:material:1.11.0")
{{ZYNTH_COMPONENT_MODULE_DEPENDENCIES}}
}
