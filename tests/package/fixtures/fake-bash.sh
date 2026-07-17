#!/usr/bin/bash
set -eu

if [[ "${1:-}" == */ci/package-smoke.sh ]]; then
  shift
  [[ "${1:-}" == --artifact-output && "${2:-}" == /* ]] || exit 64
  mkdir -p "$2"
  cp "${FAKE_NPM_TARBALL_SOURCE:?}" "$2/autoresearch-mcp-0.4.0.tgz"
  exit 0
fi

exec /usr/bin/bash "$@"
