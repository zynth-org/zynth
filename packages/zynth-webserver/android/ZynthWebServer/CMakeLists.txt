cmake_minimum_required(VERSION 3.22.1)

project(zynthwebserver)

set(CMAKE_C_STANDARD 99)
set(CMAKE_CXX_STANDARD 17)
option(ZYNTH_WEBSERVER_ENABLE_TLS "Enable TLS support in CivetWeb" OFF)
set(ZYNTH_WEBSERVER_TLS_COMPILED OFF)
set(ZYNTH_MBEDTLS_DIR ${CMAKE_CURRENT_LIST_DIR}/../../native/mbedtls)

if (ZYNTH_WEBSERVER_ENABLE_TLS AND EXISTS ${ZYNTH_MBEDTLS_DIR}/library)
  file(GLOB ZYNTH_MBEDTLS_SOURCES ${ZYNTH_MBEDTLS_DIR}/library/*.c)
  if (ZYNTH_MBEDTLS_SOURCES)
    add_library(zynthmbedtls STATIC ${ZYNTH_MBEDTLS_SOURCES})
    target_include_directories(
      zynthmbedtls
      PUBLIC
      ${ZYNTH_MBEDTLS_DIR}/include
      ${ZYNTH_MBEDTLS_DIR}/library
    )
    target_compile_options(zynthmbedtls PRIVATE -UDEBUG)
    set(ZYNTH_WEBSERVER_TLS_COMPILED ON)
  endif()
endif()

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

if (ZYNTH_WEBSERVER_ENABLE_TLS)
  if (ZYNTH_WEBSERVER_TLS_COMPILED)
    target_compile_definitions(
      zynthwebserver
      PRIVATE
      USE_MBEDTLS
    )
    target_include_directories(
      zynthwebserver
      PRIVATE
      ${ZYNTH_MBEDTLS_DIR}/include
      ${ZYNTH_MBEDTLS_DIR}/library
    )
  else()
    message(WARNING "TLS requested but mbedTLS sources were not found. Building @zynth/webserver without TLS (NO_SSL).")
    target_compile_definitions(zynthwebserver PRIVATE NO_SSL)
  endif()
else()
  target_compile_definitions(zynthwebserver PRIVATE NO_SSL)
endif()
target_compile_options(zynthwebserver PRIVATE -UDEBUG)

if (ANDROID)
  target_link_options(
    zynthwebserver
    PRIVATE
    -Wl,-z,max-page-size=16384
  )
endif()

find_library(log-lib log)

target_link_libraries(
  zynthwebserver
  ${log-lib}
  $<$<BOOL:${ZYNTH_WEBSERVER_TLS_COMPILED}>:zynthmbedtls>
)
