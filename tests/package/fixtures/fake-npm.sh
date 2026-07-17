#!/usr/bin/env bash
set -eu

if [[ -z "${FAKE_NPM_LOG:-}" ]]; then
  exec /usr/bin/npm "$@"
fi

log="${FAKE_NPM_LOG:?}"
printf '%s\n' "$*" >> "$log"
command_name="${1:-}"

published=false
grep -q '^publish ' "$log" && published=true
deprecation_value="${FAKE_NPM_DEPRECATED_INITIAL:-}"
last_deprecate="$(grep '^deprecate ' "$log" | tail -n 1 || true)"
if [[ -n "$last_deprecate" ]]; then
  deprecation_value="$(printf '%s\n' "$last_deprecate" | cut -d' ' -f3-)"
  deprecation_value="${deprecation_value% --registry=https://registry.npmjs.org/}"
fi

metadata() {
  printf '{"version":"0.4.0","dist":{"integrity":"%s"}}\n' "${FAKE_NPM_SRI:?}"
}

case "$command_name" in
  --version) printf '%s\n' '10.9.4' ;;
  whoami)
    [[ "${FAKE_NPM_WHOAMI_STATUS:-0}" == 0 ]] || exit "${FAKE_NPM_WHOAMI_STATUS}"
    printf '%s\n' "${FAKE_NPM_PUBLISHER:-shreemulay}"
    ;;
  view)
    if [[ "$*" == *' deprecated '* ]]; then
      printf '%s\n' "$deprecation_value"
      exit 0
    fi
    state="${FAKE_NPM_REGISTRY_STATE:-absent}"
    read_count="$(grep -c '^view .* --json ' "$log" || true)"
    case "$state" in
      absent)
        if $published && [[ "${FAKE_NPM_PUBLISH_STATUS:-0}" == 0 ]]; then metadata; else printf '%s\n' 'npm error code E404' >&2; exit 1; fi
        ;;
      absent-then-exact)
        if $published; then metadata; else printf '%s\n' 'npm error code E404' >&2; exit 1; fi
        ;;
      ambiguous-then-exact)
        if ((read_count < 2)); then printf '%s\n' 'npm error code ETIMEDOUT' >&2; exit 1; else metadata; fi
        ;;
      auth) printf '%s\n' 'npm error code E401' >&2; exit 1 ;;
      network) printf '%s\n' 'npm error code ETIMEDOUT' >&2; exit 1 ;;
      mixed-e404-500) printf '%s\n' 'npm error code E404' 'npm error HTTP 503' >&2; exit 1 ;;
      exact|deprecated|clear) metadata ;;
      conflict) printf '%s\n' '{"version":"0.4.0","dist":{"integrity":"sha512-CONFLICT"}}' ;;
    esac
    ;;
  pack)
    destination='.'
    previous=''
    for argument in "$@"; do
      if [[ "$previous" == '--pack-destination' ]]; then destination="$argument"; fi
      previous="$argument"
    done
    mkdir -p "$destination"
    cp "${FAKE_NPM_TARBALL_SOURCE:?}" "$destination/autoresearch-mcp-0.4.0.tgz"
    printf '%s\n' 'autoresearch-mcp-0.4.0.tgz'
    ;;
  publish) [[ "${FAKE_NPM_PUBLISH_STATUS:-0}" == 0 ]] || exit "${FAKE_NPM_PUBLISH_STATUS}" ;;
  deprecate) ;;
  init|install|audit|ls) exec /usr/bin/npm "$@" ;;
  *) printf 'fake npm: unsupported command: %s\n' "$*" >&2; exit 64 ;;
esac
