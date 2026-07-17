#!/usr/bin/env bash
set -eu

log="${FAKE_GIT_LOG:?}"
printf '%s\n' "$*" >> "$log"
sha="${FAKE_GIT_SHA:-1111111111111111111111111111111111111111}"
tag_object="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

remote_tag_state() {
  local remote=$1 configured push_pattern remote_object
  if [[ "$remote" == forgejo ]]; then
    configured="${FAKE_GIT_FORGEJO_TAG_STATE:-absent}"
  else
    configured="${FAKE_GIT_ORIGIN_TAG_STATE:-absent}"
  fi
  push_pattern="push $remote "
  if [[ "$configured" == absent ]] && grep -q "^${push_pattern}.*:refs/tags/v0.4.0$" "$log"; then
    configured=exact
  fi
  printf '%s\n' "$configured"
}

case "$*" in
  'status --porcelain')
    if [[ "${FAKE_GIT_DIRTY:-0}" == 1 ]]; then printf '%s\n' ' M package.json'; fi
    ;;
  'rev-parse HEAD') printf '%s\n' "$sha" ;;
  rev-parse*'^{}') printf '%s\n' "$sha" ;;
  rev-parse\ refs/release-control/*) printf '%s\n' "$tag_object" ;;
  cat-file\ -t\ refs/release-control/*) printf '%s\n' 'tag' ;;
  'var GIT_COMMITTER_IDENT')
    printf '%s\n' 'Release Control <release-control@example.invalid> 1784246400 +0000'
    ;;
  mktag) printf '%s\n' "$tag_object" ;;
  update-ref\ refs/release-control/*) ;;
  fetch\ --no-tags\ forgejo\ refs/tags/v0.4.0:refs/release-control/*) ;;
  ls-remote*'refs/heads/main'*)
    remote_sha="$sha"
    if [[ "$*" == *' origin '* ]]; then
      remote_sha="${FAKE_GIT_ORIGIN_MAIN_SHA:-$sha}"
      origin_reads="$(grep -c '^ls-remote origin refs/heads/main$' "$log" || true)"
      if ((origin_reads > ${FAKE_GIT_ORIGIN_ADVANCE_AFTER:-999})); then
        remote_sha='2222222222222222222222222222222222222222'
      fi
      if ((origin_reads > ${FAKE_GIT_TAMPER_AFTER_ORIGIN_READ:-999})); then
        for artifact in /tmp/verified-release-artifact.*/*.tgz; do
          if [[ -f "$artifact" ]]; then
            { chmod u+w "$artifact" && printf 'tampered' >> "$artifact"; } 2>/dev/null || true
          fi
        done
      fi
    else
      remote_sha="${FAKE_GIT_FORGEJO_MAIN_SHA:-$sha}"
    fi
    printf '%s\trefs/heads/main\n' "$remote_sha"
    ;;
  ls-remote*'refs/tags/v0.4.0'*)
    remote=forgejo
    [[ "$*" == *' origin '* ]] && remote=origin
    state="$(remote_tag_state "$remote")"
    remote_object="$tag_object"
    if [[ "$remote" == forgejo ]]; then
      remote_object="${FAKE_GIT_FORGEJO_TAG_OBJECT:-$tag_object}"
    else
      remote_object="${FAKE_GIT_ORIGIN_TAG_OBJECT:-$tag_object}"
    fi
    case "$state" in
      absent) ;;
      exact) printf '%s\trefs/tags/v0.4.0\n%s\trefs/tags/v0.4.0^{}\n' "$remote_object" "$sha" ;;
      lightweight) printf '%s\trefs/tags/v0.4.0\n' "$sha" ;;
      conflict) printf '%s\trefs/tags/v0.4.0\n%s\trefs/tags/v0.4.0^{}\n' "$tag_object" '2222222222222222222222222222222222222222' ;;
      ambiguous) exit 1 ;;
    esac
    ;;
  push\ forgejo\ refs/release-control/*:refs/tags/v0.4.0)
    source_ref="${3%%:*}"
    grep -q "^cat-file -t ${source_ref}$" "$log"
    grep -Fq "rev-parse ${source_ref}^{}" "$log"
    ;;
  push\ origin\ refs/release-control/*:refs/tags/v0.4.0)
    source_ref="${3%%:*}"
    grep -q "^fetch --no-tags forgejo refs/tags/v0.4.0:${source_ref}$" "$log"
    grep -q "^cat-file -t ${source_ref}$" "$log"
    grep -Fq "rev-parse ${source_ref}^{}" "$log"
    ;;
  *) printf 'fake git: unsupported command: %s\n' "$*" >&2; exit 64 ;;
esac
