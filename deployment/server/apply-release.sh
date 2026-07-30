#!/usr/bin/env sh
# release-governance:scoped-deployment
set -eu

release_id=${1:?release id required}
domain=${2:?domain required}
bundle_dir=${3:?bundle directory required}

case "$release_id" in
  *[!0-9a-f]*|'') printf 'invalid_release_id\n' >&2; exit 78 ;;
esac
case "$domain" in
  *[!A-Za-z0-9.-]*|'') printf 'invalid_domain\n' >&2; exit 78 ;;
esac

release_root=/opt/modludus/releases
shared_root=/opt/modludus/shared
backup_root=/opt/modludus/backups
restore_root=/opt/modludus/restore
record_root=/opt/modludus/release-records
release_dir="$release_root/$release_id"
current_link=/opt/modludus/current
nginx_target=/etc/nginx/conf.d/modludus.conf
nginx_backup="$backup_root/nginx-modludus-before-$release_id.conf"
previous_release=$(readlink "$current_link" 2>/dev/null || true)
had_nginx=false
compose_started=false
apply_complete=false

rollback() {
  exit_code=$?
  trap - EXIT INT TERM
  if test "$apply_complete" = true; then
    exit "$exit_code"
  fi
  printf 'deployment_failed: rolling back release %s\n' "$release_id" >&2
  if test "$compose_started" = true; then
    docker compose --env-file "$release_dir/.env" -f "$release_dir/docker-compose.prod.yml" down || true
  fi
  if test -n "$previous_release" && test -f "$previous_release/.env"; then
    docker compose --env-file "$previous_release/.env" -f "$previous_release/docker-compose.prod.yml" up -d || true
    ln -sfn "$previous_release" "$current_link"
  fi
  if test "$had_nginx" = true && test -f "$nginx_backup"; then
    install -m 0644 "$nginx_backup" "$nginx_target"
  else
    rm -f "$nginx_target"
  fi
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  exit "$exit_code"
}
trap rollback EXIT INT TERM

test -f "$bundle_dir/modludus-images.tar"
test -f "$bundle_dir/docker-compose.prod.yml"
test -f "$bundle_dir/attestation.sha256"
test -f "$bundle_dir/build-attestation.json"
test -f "$bundle_dir/nginx/modludus-http.conf"
test -f "$bundle_dir/nginx/modludus.conf"

(
  cd "$bundle_dir"
  sha256sum -c attestation.sha256
)

install -d -m 0750 "$release_root" "$shared_root" "$backup_root" "$restore_root" "$record_root" "$release_dir"
if test -f "$nginx_target"; then
  cp "$nginx_target" "$nginx_backup"
  chmod 0600 "$nginx_backup"
  had_nginx=true
fi

install -m 0644 "$bundle_dir/docker-compose.prod.yml" "$release_dir/docker-compose.prod.yml"
install -d -m 0755 "$release_dir/nginx"
install -m 0644 "$bundle_dir/nginx/modludus-http.conf" "$release_dir/nginx/modludus-http.conf"
install -m 0644 "$bundle_dir/nginx/modludus.conf" "$release_dir/nginx/modludus.conf"
install -m 0644 "$bundle_dir/build-attestation.json" "$release_dir/build-attestation.json"
install -m 0644 "$bundle_dir/attestation.sha256" "$release_dir/attestation.sha256"

secrets_file="$shared_root/secrets.env"
if ! test -f "$secrets_file"; then
  umask 077
  evidence_salt=$(openssl rand -hex 32)
  admin_token=$(openssl rand -hex 32)
  reviewer_token=$(openssl rand -hex 32)
  {
    printf 'MODLUDUS_EVIDENCE_SALT=%s\n' "$evidence_salt"
    printf 'MODLUDUS_ADMIN_TOKEN=%s\n' "$admin_token"
    printf 'MODLUDUS_REVIEWER_TOKEN=%s\n' "$reviewer_token"
    printf 'MODLUDUS_TRUSTED_CONFIG_JSON=\n'
  } > "$secrets_file"
fi
chmod 0600 "$secrets_file"

umask 077
{
  printf 'MODLUDUS_WEB_IMAGE=modludus-web:sha-%s\n' "$release_id"
  printf 'MODLUDUS_API_IMAGE=modludus-api:sha-%s\n' "$release_id"
  printf 'MODLUDUS_WEB_PORT=3100\n'
  printf 'MODLUDUS_API_PORT=8100\n'
  printf 'MODLUDUS_WEB_ORIGINS=https://%s\n' "$domain"
  printf 'MODLUDUS_TRUSTED_ENVIRONMENT=staging\n'
  printf 'MODLUDUS_TRUSTED_SIMULATED=false\n'
  printf 'MODLUDUS_ENABLE_ANONYMOUS_CONTRIBUTIONS=false\n'
  printf 'MODLUDUS_JOB_LEASE_SECONDS=60\n'
  printf 'MODLUDUS_WORKER_POLL_SECONDS=1\n'
  printf 'MODLUDUS_BACKUP_DIR=%s\n' "$backup_root"
  printf 'MODLUDUS_RESTORE_DIR=%s\n' "$restore_root"
  cat "$secrets_file"
} > "$release_dir/.env"
chmod 0600 "$release_dir/.env"

if test -n "$previous_release" && test -f "$previous_release/.env" && docker volume inspect modludus_evidence_data >/dev/null 2>&1; then
  backup_name="modludus-$release_id-before.zip"
  docker compose --env-file "$previous_release/.env" -f "$previous_release/docker-compose.prod.yml" --profile ops run --rm backup create --data-dir /var/lib/modludus/evidence --output "/var/lib/modludus/backups/$backup_name"
  docker compose --env-file "$previous_release/.env" -f "$previous_release/docker-compose.prod.yml" --profile ops run --rm backup verify --input "/var/lib/modludus/backups/$backup_name"
fi

docker load -i "$bundle_dir/modludus-images.tar"
docker compose --env-file "$release_dir/.env" -f "$release_dir/docker-compose.prod.yml" config >/dev/null

sed "s/__MODLUDUS_DOMAIN__/$domain/g" "$release_dir/nginx/modludus-http.conf" > "$release_dir/nginx/modludus-http.rendered.conf"
install -m 0644 "$release_dir/nginx/modludus-http.rendered.conf" "$nginx_target"
nginx -t
systemctl reload nginx

if ! test -f "/etc/letsencrypt/live/$domain/fullchain.pem"; then
  certbot certonly --webroot -w /var/www/letsencrypt -d "$domain" --non-interactive --agree-tos --register-unsafely-without-email
fi

sed "s/__MODLUDUS_DOMAIN__/$domain/g" "$release_dir/nginx/modludus.conf" > "$release_dir/nginx/modludus.rendered.conf"
install -m 0644 "$release_dir/nginx/modludus.rendered.conf" "$nginx_target"
nginx -t
systemctl reload nginx

docker compose --env-file "$release_dir/.env" -f "$release_dir/docker-compose.prod.yml" up -d
compose_started=true

attempt=0
until curl --fail --silent --max-time 5 http://127.0.0.1:3100/ >/dev/null && curl --fail --silent --max-time 5 http://127.0.0.1:8100/health | grep -q '"status":"ok"'; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 18 || exit 1
  sleep 2
done

curl --silent --show-error --max-time 45 -X POST http://127.0.0.1:8100/api/v1/ladder/refresh/openrouter > "$release_dir/openrouter-refresh.json" || true
curl --silent --show-error --max-time 60 -X POST http://127.0.0.1:8100/api/v1/ladder/refresh/artificial-analysis > "$release_dir/artificial-analysis-refresh.json" || true

ln -sfn "$release_dir" "$current_link"
python3 - "$record_root/$release_id.json" "$release_id" "$domain" "$previous_release" <<'PY'
import json
import pathlib
import sys
from datetime import datetime, timezone

path = pathlib.Path(sys.argv[1])
record = {
    "schema": "modludus-runtime-snapshot-v1",
    "release_id": sys.argv[2],
    "domain": sys.argv[3],
    "previous_release": sys.argv[4] or None,
    "web_port": 3100,
    "api_port": 8100,
    "applied_at": datetime.now(timezone.utc).isoformat(),
}
path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
path.chmod(0o600)
PY

rm -f "$bundle_dir/modludus-images.tar"
apply_complete=true
trap - EXIT INT TERM
printf 'deployment_status=passed\n'
printf 'release_id=%s\n' "$release_id"
printf 'public_url=https://%s/\n' "$domain"
