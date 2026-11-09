"""Builds the container images ON AZURE, with ACR Tasks — not on a workstation.

No local Docker daemon, no `az` CLI, no GitHub access required. The source is
packed, uploaded to the registry's own build storage, and ACR runs the build on
Azure compute. That is the same mechanism `az acr build` uses, driven here
through the REST API.

Why not a Terraform-declared task with a Git source trigger: that needs a
GitHub PAT because the repository is private. Once the repo is reachable by the
CI, an `azurerm_container_registry_task` with a source trigger is the better
end state — it rebuilds on push instead of on demand.

    python scripts/acr-build.py --registry acrdiav1dev2d24 --tag sha-abc1234
    python scripts/acr-build.py --image web            # one image only
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import tarfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Image → (context directory, Dockerfile path relative to that context).
IMAGES = {
    "web": (".", "Dockerfile"),
    "ai": ("backend", "Dockerfile"),
}

# Never uploaded: heavy, secret, or irrelevant to a build. Mirrors
# .dockerignore, kept here too because the upload happens before Docker sees it.
EXCLUDE_DIRS = {
    ".git", ".github", ".claude", "node_modules", ".next", "out", "build",
    "dist", "livrables", "infra", "__pycache__", ".venv", "venv",
    ".pytest_cache", ".vscode", ".idea",
}
EXCLUDE_SUFFIXES = (".log", ".pyc", ".pyo", ".tfstate", ".tfplan")
EXCLUDE_NAMES = {".DS_Store", "Thumbs.db"}


def azure_token(resource: str = "https://management.azure.com/") -> str:
    """Client-credentials token for the Terraform service principal."""
    cfg = json.loads(
        re.search(r"\{.*?\}", (ROOT / "infra" / "azure-configs.txt").read_text(encoding="utf-8"), re.S).group(0)
    )
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": cfg["appId"],
        "client_secret": cfg["password"],
        "resource": resource,
    }).encode()
    url = f"https://login.microsoftonline.com/{cfg['tenant']}/oauth2/token"
    return json.load(urllib.request.urlopen(url, body, timeout=60))["access_token"]


def arm(method: str, path: str, token: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        f"https://management.azure.com{path}",
        data=data,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    raw = urllib.request.urlopen(req, timeout=180).read()
    return json.loads(raw) if raw else {}


def should_skip(path: Path, context: Path) -> bool:
    rel = path.relative_to(context)
    if any(part in EXCLUDE_DIRS for part in rel.parts):
        return True
    if path.name in EXCLUDE_NAMES or path.suffix in EXCLUDE_SUFFIXES:
        return True
    # .env.example is the documented template; every other .env holds secrets.
    if path.name.startswith(".env") and path.name != ".env.example":
        return True
    return False


def pack(context: Path) -> bytes:
    """tar.gz of the build context, as ACR expects it."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for path in sorted(context.rglob("*")):
            if path.is_dir() or should_skip(path, context):
                continue
            tar.add(path, arcname=str(path.relative_to(context)).replace("\\", "/"))
    return buf.getvalue()


def upload(registry_id: str, token: str, blob: bytes) -> str:
    """Uploads the context to the registry's build storage; returns its path."""
    info = arm("POST", f"{registry_id}/listBuildSourceUploadUrl?api-version=2019-06-01-preview", token)
    req = urllib.request.Request(
        info["uploadUrl"],
        data=blob,
        method="PUT",
        headers={"x-ms-blob-type": "BlockBlob", "Content-Type": "application/gzip"},
    )
    urllib.request.urlopen(req, timeout=600).read()
    return info["relativePath"]


def schedule(registry_id: str, token: str, relative_path: str, image: str, tag: str,
             dockerfile: str, build_args: dict[str, str]) -> str:
    payload = {
        "type": "DockerBuildRequest",
        "sourceLocation": relative_path,
        "platform": {"os": "Linux", "architecture": "amd64"},
        "dockerFilePath": dockerfile,
        "imageNames": [f"diav1-{image}:{tag}", f"diav1-{image}:latest"],
        "isPushEnabled": True,
        "noCache": False,
        "timeout": 3600,
        "arguments": [
            {"name": k, "value": v, "isSecret": False} for k, v in build_args.items()
        ],
    }
    run = arm("POST", f"{registry_id}/scheduleRun?api-version=2019-06-01-preview", token, payload)
    return run["name"]


def wait(registry_id: str, token: str, run_id: str, label: str) -> str:
    """Polls until the run leaves its running state."""
    terminal = {"Succeeded", "Failed", "Canceled", "Error", "Timeout"}
    last = ""
    while True:
        run = arm("GET", f"{registry_id}/runs/{run_id}?api-version=2019-06-01-preview", token)
        status = run["properties"]["status"]
        if status != last:
            print(f"  [{label}] {status}")
            last = status
        if status in terminal:
            return status
        time.sleep(15)


def logs(registry_id: str, token: str, run_id: str) -> str:
    link = arm("POST", f"{registry_id}/runs/{run_id}/listLogSasUrl?api-version=2019-06-01-preview", token)
    return urllib.request.urlopen(link["logLink"], timeout=120).read().decode("utf-8", "replace")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the images on Azure with ACR Tasks.")
    parser.add_argument("--registry", default="acrdiav1dev2d24")
    parser.add_argument("--resource-group", default="rg-diav1-dev-frc")
    parser.add_argument("--subscription", default="acf4a7fb-6cec-4424-b6df-16ae927828e4")
    parser.add_argument("--tag", default=None, help="image tag; defaults to sha-<short commit>")
    parser.add_argument("--image", choices=sorted(IMAGES), default=None, help="build only this image")
    parser.add_argument("--logs", action="store_true", help="print the build log on failure")
    args = parser.parse_args()

    tag = args.tag or os.popen("git rev-parse --short HEAD").read().strip() or "manual"
    if not tag.startswith("sha-") and re.fullmatch(r"[0-9a-f]{7,40}", tag):
        tag = f"sha-{tag}"

    token = azure_token()
    registry_id = (
        f"/subscriptions/{args.subscription}/resourceGroups/{args.resource_group}"
        f"/providers/Microsoft.ContainerRegistry/registries/{args.registry}"
    )

    # Public values baked into the client bundle at build time.
    build_args = {
        "NEXT_PUBLIC_SUPABASE_URL": os.getenv("NEXT_PUBLIC_SUPABASE_URL", ""),
        "NEXT_PUBLIC_SUPABASE_ANON_KEY": os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ""),
        "NEXT_PUBLIC_VAPID_PUBLIC_KEY": os.getenv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", ""),
        "NEXT_PUBLIC_ASSETS_URL": os.getenv("NEXT_PUBLIC_ASSETS_URL", ""),
        "BUILD_ID": tag,
    }

    targets = [args.image] if args.image else list(IMAGES)
    failures = []

    for image in targets:
        context_dir, dockerfile = IMAGES[image]
        context = (ROOT / context_dir).resolve()
        print(f"\n▸ {image}: packing {context_dir} …")
        blob = pack(context)
        print(f"  {len(blob) / 1024 / 1024:.1f} Mo à téléverser")

        path = upload(registry_id, token, blob)
        run_id = schedule(registry_id, token, path, image, tag, dockerfile,
                          build_args if image == "web" else {"BUILD_ID": tag})
        print(f"  run {run_id} lancé sur Azure")

        status = wait(registry_id, token, run_id, image)
        if status != "Succeeded":
            failures.append((image, run_id, status))
            if args.logs:
                print(logs(registry_id, token, run_id)[-4000:])

    print()
    if failures:
        for image, run_id, status in failures:
            print(f"ÉCHEC  {image}  run={run_id}  status={status}")
        print("Relancer avec --logs pour le journal de construction.")
        return 1

    print(f"Images construites et poussées : {', '.join(f'diav1-{i}:{tag}' for i in targets)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
