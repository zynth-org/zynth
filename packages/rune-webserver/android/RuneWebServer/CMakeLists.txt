cmake_minimum_required(VERSION 3.22.1)

project(runewebserver)

set(CMAKE_C_STANDARD 99)
set(CMAKE_CXX_STANDARD 17)

add_library(
  runewebserver
  SHARED
  src/main/cpp/rune_webserver_jni.cpp
  ../../native/rune_webserver.c
  ../../native/civetweb/civetweb.c
)

target_include_directories(
  runewebserver
  PRIVATE
  ../../native
  ../../native/civetweb
)

target_compile_definitions(runewebserver PRIVATE NO_SSL)

find_library(log-lib log)

target_link_libraries(
  runewebserver
  ${log-lib}
)
