#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 0 ]]; then
  printf 'Usage: %s\n' "$0" >&2
  exit 2
fi

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENGINE_SOURCE="$REPOSITORY_ROOT/simc"
BUILD_DIRECTORY="$REPOSITORY_ROOT/.local/simc-build"

for tool in git cmake; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Required tool missing: %s. Install Git and CMake 3.13+ before building.\n' "$tool" >&2
    exit 1
  fi
done

if [[ ! -f "$ENGINE_SOURCE/.git" || ! -f "$ENGINE_SOURCE/CMakeLists.txt" ]]; then
  printf 'Initialize the engine from the repository root: git submodule update --init --recursive -- simc\n' >&2
  exit 1
fi

EXPECTED_REVISION="$(git -C "$REPOSITORY_ROOT" rev-parse HEAD:simc)"
SOURCE_REVISION="$(git -C "$ENGINE_SOURCE" rev-parse HEAD)"
if [[ "$SOURCE_REVISION" != "$EXPECTED_REVISION" ]]; then
  printf 'The simc checkout differs from the repository pin. Inspect it before running git submodule update --init --recursive -- simc.\n' >&2
  exit 1
fi

mkdir -p "$REPOSITORY_ROOT/.local"
LOG_DIRECTORY="$(mktemp -d "$REPOSITORY_ROOT/.local/build-log.XXXXXX")"
printf 'Build logs: %s\n' "$LOG_DIRECTORY"

cmake -S "$ENGINE_SOURCE" -B "$BUILD_DIRECTORY" \
  -DBUILD_GUI=OFF \
  -DBUILD_TESTING=OFF \
  -DCMAKE_BUILD_TYPE=Release \
  2>&1 | tee "$LOG_DIRECTORY/configure.log"
cmake --build "$BUILD_DIRECTORY" --target simc --parallel 4 \
  2>&1 | tee "$LOG_DIRECTORY/build.log"

if [[ ! -x "$BUILD_DIRECTORY/simc" ]]; then
  printf 'Expected CLI not found at %s/simc. Use a single-configuration CMake generator.\n' "$BUILD_DIRECTORY" >&2
  exit 1
fi
printf 'CLI ready: %s/simc\n' "$BUILD_DIRECTORY"
