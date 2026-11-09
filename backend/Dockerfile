# syntax=docker/dockerfile:1.7
#
# FastAPI + LangGraph backend.
#
# The same image serves three roles, selected by the command:
#   · the API service          uvicorn app.main:app
#   · the ETL job              python -m app.etl.cli --scope incremental
#   · the migration job        python -m app.db.migrate
#
# One image means one build, one scan and one signature to verify, and it
# guarantees the job and the service run identical code.
#
# BUILD CONTEXT = REPOSITORY ROOT, not ./backend:
#
#     docker build -f backend/Dockerfile .
#
# The migration job applies supabase/migrations/*.sql, which live outside
# backend/ and are shared with the Supabase tooling. A context rooted at
# ./backend cannot see them, so the job had nothing to apply.

# ─── Stage 1: dependencies ─────────────────────────────────
FROM python:3.12-slim AS deps

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Build toolchain lives here and never reaches the runtime image.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip setuptools \
    && /opt/venv/bin/pip install -r requirements.txt

# ─── Stage 2: runtime ──────────────────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH" \
    PORT=8000

# libpq for psycopg, tini to forward SIGTERM and reap zombies.
#
# `upgrade` before install: the python:3.12-slim tag lags its Debian base, and
# the gap showed up as nine HIGH findings in packages nothing here pulls in
# directly (bsdutils and friends). Upgrading closes them at build time instead
# of waiting for the upstream tag to be rebuilt.
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
      libpq5 tini curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 appuser

# Le setuptools du Python système, distinct de celui du venv, reste sur la
# version que porte le tag de base (70.3.0, CVE-2025-47273). Rien ici ne s'en
# sert — tout tourne depuis /opt/venv — mais il est présent dans l'image et le
# scan le compte, donc on le remonte plutôt que de le laisser traîner.
RUN pip install --no-cache-dir --upgrade setuptools

WORKDIR /app

COPY --from=deps /opt/venv /opt/venv

# pip est retiré des deux préfixes, comme npm l'est de l'image web.
#
# Les deux dernières vulnérabilités de cette image ne venaient ni du venv ni du
# système — l'inventaire a montré msgpack en 1.2.1 et setuptools en 84.0.0 aux
# deux endroits — mais de pip/_vendor, où pip fige ses propres copies
# (msgpack 1.1.2, et le pkg_resources rattaché à setuptools 70.3.0). Aucune
# n'est atteignable : le conteneur exécute uvicorn, il n'installe jamais rien.
#
# Suppression après le COPY, pas avant : Trivy analyse le système de fichiers
# aplati, donc un fichier effacé dans une couche ultérieure disparaît du scan.
RUN rm -rf /opt/venv/lib/python3.12/site-packages/pip \
           /opt/venv/lib/python3.12/site-packages/pip-*.dist-info \
           /opt/venv/bin/pip /opt/venv/bin/pip3 /opt/venv/bin/pip3.12 \
           /usr/local/lib/python3.12/site-packages/pip \
           /usr/local/lib/python3.12/site-packages/pip-*.dist-info \
           /usr/local/bin/pip /usr/local/bin/pip3 /usr/local/bin/pip3.12
COPY --chown=appuser:appuser backend/ .

# Les migrations, hors de backend/ : c'est `python -m app.db.migrate` qui les
# applique, et MIGRATIONS_DIR pointe ici par défaut.
COPY --chown=appuser:appuser supabase/migrations /app/migrations

USER appuser
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]

# --timeout-graceful-shutdown gives in-flight agent turns time to finish; an
# LLM round trip can outlast the default and would otherwise be cut off mid
# answer during a revision swap.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers ${UVICORN_WORKERS:-2} --timeout-graceful-shutdown 30"]
