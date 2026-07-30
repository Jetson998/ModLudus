#!/usr/bin/env sh
set -eu

domain=${1:?domain required}
case "$domain" in
  *[!A-Za-z0-9.-]*) printf 'invalid_domain\n' >&2; exit 78 ;;
esac

command -v docker >/dev/null
command -v nginx >/dev/null
command -v certbot >/dev/null
docker compose version >/dev/null
nginx -t >/dev/null

available_kb=$(df -Pk /opt 2>/dev/null | awk 'NR==2 {print $4}')
test "${available_kb:-0}" -ge 5242880 || {
  printf 'insufficient_disk_kb=%s\n' "${available_kb:-0}" >&2
  exit 78
}

for port in 3100 8100; do
  occupied=$(ss -ltnH "sport = :$port" 2>/dev/null || true)
  if test -n "$occupied" && ! docker ps --filter name=modludus --format '{{.Ports}}' | grep -q "127.0.0.1:$port"; then
    printf 'port_conflict=%s\n' "$port" >&2
    exit 78
  fi
done

printf 'preflight_status=passed\n'
printf 'hostname=%s\n' "$(hostname)"
printf 'domain=%s\n' "$domain"
printf 'available_disk_kb=%s\n' "$available_kb"
printf 'existing_current=%s\n' "$(readlink /opt/modludus/current 2>/dev/null || true)"
printf 'existing_containers=%s\n' "$(docker ps --filter name=modludus --format '{{.Names}}' | tr '\n' ',' | sed 's/,$//')"
