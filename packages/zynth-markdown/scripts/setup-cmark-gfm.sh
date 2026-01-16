#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/../../.." && pwd)

cd "${ROOT_DIR}"

SUBMODULE_PATH="packages/zynth-markdown/native/cmark-gfm"

if ! git -C "${ROOT_DIR}" ls-files --stage "${SUBMODULE_PATH}" >/dev/null 2>&1; then
  if [ -f "${ROOT_DIR}/.gitmodules" ]; then
    SUBMODULE_URL=$(
      git -C "${ROOT_DIR}" config -f "${ROOT_DIR}/.gitmodules" \
        --get submodule.${SUBMODULE_PATH}.url || true
    )
  else
    SUBMODULE_URL=""
  fi
  if [ -z "${SUBMODULE_URL}" ]; then
    SUBMODULE_URL="https://github.com/github/cmark-gfm.git"
  fi
  git -C "${ROOT_DIR}" submodule add "${SUBMODULE_URL}" "${SUBMODULE_PATH}"
fi

git -C "${ROOT_DIR}" submodule update --init --recursive "${SUBMODULE_PATH}"

STUB_DIR="${ROOT_DIR}/packages/zynth-markdown/native/cmark-gfm-stubs"
CMARK_SRC_DIR="${ROOT_DIR}/packages/zynth-markdown/native/cmark-gfm/src"

if [ -d "${STUB_DIR}" ] && [ -d "${CMARK_SRC_DIR}" ]; then
  cp "${STUB_DIR}/config.h" "${CMARK_SRC_DIR}/config.h"
  cp "${STUB_DIR}/cmark-gfm_version.h" "${CMARK_SRC_DIR}/cmark-gfm_version.h"
  cp "${STUB_DIR}/cmark-gfm_export.h" "${CMARK_SRC_DIR}/cmark-gfm_export.h"
fi

echo "[zynth-markdown] cmark-gfm submodule ready (headers applied)"
