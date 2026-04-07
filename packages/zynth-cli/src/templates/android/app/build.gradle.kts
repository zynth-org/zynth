plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

import java.util.Properties
import java.io.FileInputStream

android {
  namespace = "{{BUNDLE_ID}}"
  compileSdk = 35
  buildFeatures {
    buildConfig = true
  }

  signingConfigs {
    create("release") {
      val keystorePropertiesFile = rootProject.file("keystore.properties")
      val keystoreProperties = Properties()
      if (keystorePropertiesFile.exists()) {
        keystoreProperties.load(FileInputStream(keystorePropertiesFile))
      }

      keyAlias = keystoreProperties["keyAlias"] as String? ?: System.getenv("ZYNTH_KEY_ALIAS")
      keyPassword = keystoreProperties["keyPassword"] as String? ?: System.getenv("ZYNTH_KEY_PASSWORD")
      storeFile = (keystoreProperties["storeFile"] as String?)?.let { file(it) } ?: System.getenv("ZYNTH_KEYSTORE_FILE")?.let { file(it) }
      storePassword = keystoreProperties["storePassword"] as String? ?: System.getenv("ZYNTH_KEYSTORE_PASSWORD")
    }
  }

  defaultConfig {
    applicationId = "{{BUNDLE_ID}}"
    minSdk = 24
    targetSdk = 35
    versionCode = {{VERSION_CODE}}
    versionName = "{{VERSION_NAME}}"
    buildConfigField("String", "ZYNTH_DEV_SERVER_URL", {{ZYNTH_DEV_SERVER_URL}})
    buildConfigField("String", "ZYNTH_DEV_SERVER_TOKEN", {{ZYNTH_DEV_SERVER_TOKEN}})
    buildConfigField("boolean", "ZYNTH_STARTUP_METRICS_ENABLED", {{ZYNTH_STARTUP_METRICS_ENABLED}})
  }

  buildTypes {
    release {
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      if (signingConfigs.getByName("release").storeFile != null) {
        signingConfig = signingConfigs.getByName("release")
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

  packaging {
    jniLibs {
      pickFirsts += setOf(
        "**/libc++_shared.so",
        "**/libhermesvm.so"
      )
      excludes += setOf(
        "**/libfabricjni.so",
        "**/libreactnativejni.so",
        "**/libreactnative.so",
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
  implementation("androidx.core:core-ktx:1.15.0")
  implementation("androidx.activity:activity-ktx:1.9.3")
  implementation("androidx.core:core-splashscreen:1.0.1")
  implementation("androidx.appcompat:appcompat:1.7.0")
  implementation("com.google.android.material:material:1.12.0")
{{ZYNTH_COMPONENT_MODULE_DEPENDENCIES}}
}
