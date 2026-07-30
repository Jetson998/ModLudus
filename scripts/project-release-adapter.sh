#!/usr/bin/env sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
state_root="$root_dir/.release-state"
record_root="$root_dir/deployment/release-records"
command_name=${1:-status}
shift || true

release_id=${MODLUDUS_RELEASE_ID:-$(git -C "$root_dir" rev-parse HEAD)}
target=${MODLUDUS_DEPLOY_TARGET:-root@152.32.172.162}
domain=${MODLUDUS_DOMAIN:-modludus.152.32.172.162.sslip.io}
state_dir="$state_root/$release_id"
web_image="modludus-web:sha-${release_id}"
api_image="modludus-api:sha-${release_id}"

require_file() {
  test -f "$root_dir/$1" || {
    printf 'required_file_missing: %s\n' "$1" >&2
    exit 78
  }
}

validate_contract() {
  require_file release-governance.json
  require_file docker-compose.prod.yml
  require_file .env.production.example
  require_file deployment/nginx/modludus-http.conf
  require_file deployment/nginx/modludus.conf
  require_file deployment/server/preflight-release.sh
  require_file deployment/server/apply-release.sh
  grep -q 'release-governance:scoped-deployment' "$root_dir/docker-compose.prod.yml"
  grep -q 'release-governance:scoped-deployment' "$root_dir/deployment/server/apply-release.sh"
  python3 -m json.tool "$root_dir/release-governance.json" >/dev/null
}

require_prepared() {
  test -f "$state_dir/inputs.env" || {
    printf 'release_not_prepared: %s\n' "$release_id" >&2
    exit 78
  }
}

case "$command_name" in
  validate)
    validate_contract
    printf 'release_governance_valid: %s\n' "$release_id"
    ;;
  prepare)
    validate_contract
    test "$(git -C "$root_dir" rev-parse HEAD)" = "$release_id" || {
      printf 'source_revision_mismatch\n' >&2
      exit 78
    }
    mkdir -p "$state_dir" "$record_root"
    {
      printf 'MODLUDUS_RELEASE_ID=%s\n' "$release_id"
      printf 'MODLUDUS_DEPLOY_TARGET=%s\n' "$target"
      printf 'MODLUDUS_DOMAIN=%s\n' "$domain"
      printf 'MODLUDUS_WEB_IMAGE=%s\n' "$web_image"
      printf 'MODLUDUS_API_IMAGE=%s\n' "$api_image"
    } > "$state_dir/inputs.env"
    printf 'prepared: %s target=%s domain=%s\n' "$release_id" "$target" "$domain"
    ;;
  verify)
    require_prepared
    validate_contract
    test -z "$(git -C "$root_dir" status --porcelain)" || {
      printf 'repository_not_clean\n' >&2
      exit 78
    }
    test "$(git -C "$root_dir" rev-parse HEAD)" = "$release_id"
    test "$(git -C "$root_dir" rev-parse origin/main)" = "$release_id" || {
      printf 'origin_main_mismatch\n' >&2
      exit 78
    }
    git -C "$root_dir" diff --check
    npm --prefix "$root_dir/apps/web" run verify
    PYTHONPATH="$root_dir/apps/api" python3 -B -m unittest discover -s "$root_dir/apps/api/tests" -v
    docker compose --env-file "$root_dir/.env.production.example" -f "$root_dir/docker-compose.prod.yml" config >/dev/null
    printf 'verified: %s\n' "$release_id" | tee "$state_dir/repository-gate.txt"
    ;;
  package)
    require_prepared
    test -f "$state_dir/repository-gate.txt" || {
      printf 'repository_gate_missing\n' >&2
      exit 78
    }
    docker build --platform linux/amd64 --build-arg NEXT_PUBLIC_API_URL= --build-arg NEXT_PUBLIC_ENABLE_ANONYMOUS_CONTRIBUTIONS=false -t "$web_image" "$root_dir/apps/web"
    docker build --platform linux/amd64 -t "$api_image" "$root_dir/apps/api"
    docker save -o "$state_dir/modludus-images.tar" "$web_image" "$api_image"
    cp "$root_dir/docker-compose.prod.yml" "$state_dir/docker-compose.prod.yml"
    mkdir -p "$state_dir/nginx" "$state_dir/server"
    cp "$root_dir/deployment/nginx/modludus-http.conf" "$state_dir/nginx/modludus-http.conf"
    cp "$root_dir/deployment/nginx/modludus.conf" "$state_dir/nginx/modludus.conf"
    cp "$root_dir/deployment/server/apply-release.sh" "$state_dir/server/apply-release.sh"
    (
      cd "$state_dir"
      sha256sum modludus-images.tar docker-compose.prod.yml nginx/modludus-http.conf nginx/modludus.conf server/apply-release.sh > attestation.sha256
    )
    printf 'packaged: %s\n' "$state_dir/modludus-images.tar"
    ;;
  attest)
    require_prepared
    (
      cd "$state_dir"
      sha256sum -c attestation.sha256
    )
    python3 - "$state_dir" "$release_id" "$web_image" "$api_image" <<'PY'
import hashlib
import json
import pathlib
import sys
from datetime import datetime, timezone

state_dir = pathlib.Path(sys.argv[1])
artifact = state_dir / "modludus-images.tar"
digest = hashlib.sha256()
with artifact.open("rb") as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b""):
        digest.update(chunk)
record = {
    "schema": "modludus-build-attestation-v1",
    "source_revision": sys.argv[2],
    "web_image": sys.argv[3],
    "api_image": sys.argv[4],
    "artifact": artifact.name,
    "artifact_sha256": digest.hexdigest(),
    "created_at": datetime.now(timezone.utc).isoformat(),
}
(state_dir / "build-attestation.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
PY
    printf 'attested: %s\n' "$state_dir/build-attestation.json"
    ;;
  preflight)
    require_prepared
    test -f "$state_dir/build-attestation.json" || {
      printf 'build_attestation_missing\n' >&2
      exit 78
    }
    ssh -o BatchMode=yes -o ConnectTimeout=10 "$target" "sh -s -- '$domain'" < "$root_dir/deployment/server/preflight-release.sh" | tee "$state_dir/target-preflight.txt"
    grep -q '^preflight_status=passed$' "$state_dir/target-preflight.txt"
    ;;
  deploy)
    require_prepared
    test "${MODLUDUS_DEPLOY_CONFIRM:-}" = "$release_id" || {
      printf 'deploy_confirmation_required: set MODLUDUS_DEPLOY_CONFIRM=%s\n' "$release_id" >&2
      exit 78
    }
    test -f "$state_dir/target-preflight.txt"
    test -f "$state_dir/build-attestation.json"
    remote_bundle="/tmp/modludus-release-$release_id"
    ssh -o BatchMode=yes "$target" "install -d -m 0700 '$remote_bundle/nginx' '$remote_bundle/server'"
    scp "$state_dir/modludus-images.tar" "$state_dir/docker-compose.prod.yml" "$state_dir/attestation.sha256" "$state_dir/build-attestation.json" "$target:$remote_bundle/"
    scp "$state_dir/nginx/modludus-http.conf" "$state_dir/nginx/modludus.conf" "$target:$remote_bundle/nginx/"
    scp "$state_dir/server/apply-release.sh" "$target:$remote_bundle/server/"
    ssh -o BatchMode=yes "$target" "sh '$remote_bundle/server/apply-release.sh' '$release_id' '$domain' '$remote_bundle'"
    printf 'deployed: %s\n' "$release_id" | tee "$state_dir/apply-gate.txt"
    ;;
  acceptance)
    require_prepared
    test -f "$state_dir/apply-gate.txt"
    curl --fail --silent --show-error --max-time 20 "https://$domain/" >/dev/null
    curl --fail --silent --show-error --max-time 20 "https://$domain/api/health" | grep -q '"status":"ok"'
    ssh -o BatchMode=yes "$target" "test \"\$(readlink /opt/modludus/current)\" = '/opt/modludus/releases/$release_id' && docker ps --filter name=modludus --format '{{.Names}}|{{.Status}}'"
    {
      printf 'acceptance_status=passed\n'
      printf 'release_id=%s\n' "$release_id"
      printf 'public_url=https://%s/\n' "$domain"
    } | tee "$state_dir/acceptance.txt"
    ;;
  finalize)
    require_prepared
    test -f "$state_dir/acceptance.txt"
    python3 - "$state_dir" "$record_root/$release_id.json" "$release_id" "$target" "$domain" <<'PY'
import json
import pathlib
import sys
from datetime import datetime, timezone

state_dir = pathlib.Path(sys.argv[1])
attestation = json.loads((state_dir / "build-attestation.json").read_text())
record = {
    "schema": "modludus-release-record-v1",
    "status": "succeeded",
    "source_revision": sys.argv[3],
    "target": sys.argv[4],
    "public_url": f"https://{sys.argv[5]}/",
    "artifact_digest": attestation["artifact_sha256"],
    "runtime_snapshot": "/opt/modludus/release-records/" + sys.argv[3] + ".json",
    "backup_reference": "first-deploy-no-prior-volume-or dated verified archive on upgrade",
    "acceptance_result": "passed",
    "completed_at": datetime.now(timezone.utc).isoformat(),
}
path = pathlib.Path(sys.argv[2])
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
PY
    printf 'finalized: %s\n' "$record_root/$release_id.json"
    ;;
  status)
    if test -d "$state_dir"; then
      find "$state_dir" -maxdepth 2 -type f -print | sort
    else
      printf 'release_state_missing: %s\n' "$release_id"
    fi
    ;;
  *)
    printf 'unsupported_adapter_command: %s\n' "$command_name" >&2
    exit 64
    ;;
esac
