#!/usr/bin/env python3
import argparse
import base64
import json
import mimetypes
import os
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

DEFAULT_SUPABASE_URL = "http://127.0.0.1:8000"
DEFAULT_BUCKET = "gear-photos"


def load_env(path):
  values = {}
  env_path = Path(path)
  if not env_path.exists():
    return values

  for raw_line in env_path.read_text().splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
      continue
    key, value = line.split("=", 1)
    values[key.strip()] = value.strip().strip('"').strip("'")
  return values


def required_config(args):
  env = load_env(args.env_file)
  supabase_url = (
    args.supabase_url
    or os.environ.get("SUPABASE_URL")
    or env.get("SUPABASE_URL")
    or DEFAULT_SUPABASE_URL
  ).rstrip("/")
  service_role_key = (
    args.service_role_key
    or os.environ.get("SERVICE_ROLE_KEY")
    or env.get("SERVICE_ROLE_KEY")
  )

  if not service_role_key:
    raise SystemExit("SERVICE_ROLE_KEY is required in env, .env, or --service-role-key")

  return supabase_url, service_role_key


def api_headers(service_role_key, extra=None):
  headers = {
    "apikey": service_role_key,
    "Authorization": f"Bearer {service_role_key}",
  }
  if extra:
    headers.update(extra)
  return headers


def request_json(method, url, service_role_key, payload=None, headers=None):
  body = None
  extra_headers = headers or {}
  if payload is not None:
    body = json.dumps(payload).encode("utf-8")
    extra_headers = {"Content-Type": "application/json", **extra_headers}

  req = Request(url, data=body, method=method, headers=api_headers(service_role_key, extra_headers))
  with urlopen(req, timeout=60) as response:
    raw = response.read()
    if not raw:
      return None
    return json.loads(raw.decode("utf-8"))


def request_bytes(method, url, service_role_key, body=None, headers=None):
  req = Request(url, data=body, method=method, headers=api_headers(service_role_key, headers))
  with urlopen(req, timeout=120) as response:
    return response.read()


def parse_data_url(data_url):
  if not data_url.startswith("data:") or ";base64," not in data_url:
    raise ValueError("image_path is not a base64 data URL")

  metadata, encoded = data_url.split(",", 1)
  mime_type = metadata[5:].split(";", 1)[0] or "application/octet-stream"
  return mime_type, base64.b64decode(encoded)


def target_object_path(item_id):
  return f"{item_id}/image.jpg"


def storage_upload_url(supabase_url, bucket, path):
  return f"{supabase_url}/storage/v1/object/{bucket}/{quote(path, safe='/')}"


def storage_download_url(supabase_url, bucket, path):
  return f"{supabase_url}/storage/v1/object/authenticated/{bucket}/{quote(path, safe='/')}"


def gear_items_url(supabase_url, query):
  return f"{supabase_url}/rest/v1/gear_items?{query}"


def fetch_data_url_items(supabase_url, service_role_key, limit):
  query = urlencode({
    "select": "id,name,image_path",
    "image_path": "like.data:%",
    "order": "id.asc",
    "limit": str(limit),
  })
  return request_json("GET", gear_items_url(supabase_url, query), service_role_key) or []


def fetch_legacy_path_items(supabase_url, service_role_key, limit):
  query = urlencode({
    "select": "id,name,image_path",
    "image_path": "not.like.data:%",
    "order": "id.asc",
    "limit": str(limit),
  })
  items = request_json("GET", gear_items_url(supabase_url, query), service_role_key) or []
  return [
    item for item in items
    if item.get("image_path")
    and "/" in item["image_path"]
    and item["image_path"].split("/", 1)[0] != item["id"]
  ]


def upload_object(supabase_url, service_role_key, bucket, path, content, mime_type):
  request_bytes(
    "POST",
    storage_upload_url(supabase_url, bucket, path),
    service_role_key,
    body=content,
    headers={
      "Content-Type": mime_type,
      "Cache-Control": "3600",
      "x-upsert": "true",
    },
  )


def update_image_path(supabase_url, service_role_key, item_id, new_path):
  url = f"{supabase_url}/rest/v1/gear_items?id=eq.{quote(item_id)}"
  request_json(
    "PATCH",
    url,
    service_role_key,
    payload={"image_path": new_path},
    headers={"Prefer": "return=minimal"},
  )


def migrate_data_url_item(args, supabase_url, service_role_key, item):
  item_id = item["id"]
  new_path = target_object_path(item_id)
  mime_type, content = parse_data_url(item["image_path"])

  if args.dry_run:
    return {
      "item_id": item_id,
      "name": item.get("name"),
      "old_len": len(item["image_path"]),
      "new_path": new_path,
      "status": "dry-run",
    }

  upload_object(supabase_url, service_role_key, args.bucket, new_path, content, mime_type)
  update_image_path(supabase_url, service_role_key, item_id, new_path)
  return {
    "item_id": item_id,
    "name": item.get("name"),
    "old_len": len(item["image_path"]),
    "new_path": new_path,
    "status": "migrated",
  }


def migrate_legacy_path_item(args, supabase_url, service_role_key, item):
  item_id = item["id"]
  old_path = item["image_path"]
  new_path = target_object_path(item_id)
  mime_type = mimetypes.guess_type(old_path)[0] or "image/jpeg"

  if args.dry_run:
    return {
      "item_id": item_id,
      "name": item.get("name"),
      "old_path": old_path,
      "new_path": new_path,
      "status": "dry-run-legacy",
    }

  content = request_bytes("GET", storage_download_url(supabase_url, args.bucket, old_path), service_role_key)
  upload_object(supabase_url, service_role_key, args.bucket, new_path, content, mime_type)
  update_image_path(supabase_url, service_role_key, item_id, new_path)
  return {
    "item_id": item_id,
    "name": item.get("name"),
    "old_path": old_path,
    "new_path": new_path,
    "status": "migrated-legacy",
  }


def main():
  parser = argparse.ArgumentParser(description="Move gear item data URL images into Supabase Storage.")
  parser.add_argument("--env-file", default=".env")
  parser.add_argument("--supabase-url")
  parser.add_argument("--service-role-key")
  parser.add_argument("--bucket", default=DEFAULT_BUCKET)
  parser.add_argument("--limit", type=int, default=1000)
  parser.add_argument("--dry-run", action="store_true")
  parser.add_argument("--include-legacy-paths", action="store_true")
  args = parser.parse_args()

  supabase_url, service_role_key = required_config(args)
  results = []

  try:
    for item in fetch_data_url_items(supabase_url, service_role_key, args.limit):
      results.append(migrate_data_url_item(args, supabase_url, service_role_key, item))

    if args.include_legacy_paths:
      for item in fetch_legacy_path_items(supabase_url, service_role_key, args.limit):
        results.append(migrate_legacy_path_item(args, supabase_url, service_role_key, item))
  except HTTPError as error:
    body = error.read().decode("utf-8", errors="replace")
    print(json.dumps({"status": "error", "code": error.code, "body": body}, ensure_ascii=False), file=sys.stderr)
    return 1

  for result in results:
    print(json.dumps(result, ensure_ascii=False))

  print(json.dumps({
    "status": "complete",
    "dry_run": args.dry_run,
    "processed": len(results),
  }, ensure_ascii=False))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
