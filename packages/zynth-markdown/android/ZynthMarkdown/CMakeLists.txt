cmake_minimum_required(VERSION 3.22.1)

project(zynthmarkdown)

set(CMAKE_C_STANDARD 99)
set(CMAKE_CXX_STANDARD 17)

set(CMARK_DIR ../../native/cmark-gfm)
set(CMARK_STUB_DIR ../../native/cmark-gfm-stubs)

file(GLOB CMARK_SOURCES
  ${CMARK_DIR}/src/*.c
  ${CMARK_DIR}/extensions/*.c
)
list(REMOVE_ITEM CMARK_SOURCES ${CMARK_DIR}/src/main.c)

add_library(
  zynthmarkdown
  SHARED
  src/main/cpp/zynth_markdown_jni.cpp
  ../../native/zynth_markdown.cpp
  ${CMARK_SOURCES}
)

target_include_directories(
  zynthmarkdown
  PRIVATE
  ../../native
  ${CMARK_STUB_DIR}
  ${CMARK_DIR}/src
  ${CMARK_DIR}/extensions
)

find_library(log-lib log)

target_link_libraries(
  zynthmarkdown
  ${log-lib}
)
