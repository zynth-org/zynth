plugins {
    id("com.android.library")
    id("kotlin-android")
}

android {
    namespace = "com.zynth.hypervisor"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation(project(":ZynthKit"))
    implementation(project(":ZynthAPIs"))
    implementation("org.jetbrains.kotlin:kotlin-stdlib:2.1.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
