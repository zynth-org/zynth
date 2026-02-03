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
  File(rootDir, "../node_modules"),
  File(rootDir, "../../node_modules"),
  File(rootDir, "../../../node_modules"),
  File(rootDir, "../../../../node_modules")
).map { File(it, "{{ZYNTH_ANDROID_RUNTIME_PACKAGE}}/{{ZYNTH_ANDROID_RUNTIME_SUBDIR}}") }
  .firstOrNull { it.exists() }
  ?: error("Unable to locate @zynth/core package from $rootDir")

project(":ZynthKit").projectDir = zynthAndroidDir

{{ZYNTH_COMPONENT_MODULE_INCLUDES}}
