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
).map { File(it, "@zynth/android/android/ZynthKit") }
  .firstOrNull { it.exists() }
  ?: error("Unable to locate @zynth/android package from $rootDir")

project(":ZynthKit").projectDir = zynthAndroidDir

{{ZYNTH_COMPONENT_MODULE_INCLUDES}}
