import java.io.File
pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}

dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    google()
    mavenCentral()
  }
}

rootProject.name = "{{APP_NAME}}Android"
include(":app")
include(":ZynthKit")

val zynthAndroidDir = listOf(
  File(rootDir, "../../../packages/zynth-core/android/ZynthKit"),
  File(rootDir, "../node_modules/{{ZYNTH_ANDROID_RUNTIME_PACKAGE}}/{{ZYNTH_ANDROID_RUNTIME_SUBDIR}}"),
  File(rootDir, "../../node_modules/{{ZYNTH_ANDROID_RUNTIME_PACKAGE}}/{{ZYNTH_ANDROID_RUNTIME_SUBDIR}}"),
  File(rootDir, "../../../node_modules/{{ZYNTH_ANDROID_RUNTIME_PACKAGE}}/{{ZYNTH_ANDROID_RUNTIME_SUBDIR}}"),
  File(rootDir, "../../../../node_modules/{{ZYNTH_ANDROID_RUNTIME_PACKAGE}}/{{ZYNTH_ANDROID_RUNTIME_SUBDIR}}")
).firstOrNull { it.exists() }
  ?: error("Unable to locate @zynthjs/core package from $rootDir")

project(":ZynthKit").projectDir = zynthAndroidDir

{{ZYNTH_COMPONENT_MODULE_INCLUDES}}
