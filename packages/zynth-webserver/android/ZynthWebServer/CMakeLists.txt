cmake_minimum_required(VERSION 3.22.1)

project(zynthwebserver)

set(CMAKE_C_STANDARD 99)
set(CMAKE_CXX_STANDARD 17)

add_library(
  zynthwebserver
  SHARED
  src/main/cpp/zynth_webserver_jni.cpp
  ../../native/zynth_webserver.c
  ../../native/civetweb/civetweb.c
)

target_include_directories(
  zynthwebserver
  PRIVATE
  ../../native
  ../../native/civetweb
)

target_compile_definitions(zynthwebserver PRIVATE NO_SSL)

find_library(log-lib log)

target_link_libraries(
  zynthwebserver
  ${log-lib}
)
