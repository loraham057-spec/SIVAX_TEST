"""Applique les migrations SQL, dans l'ordre, une seule fois chacune.

    python -m app.db.migrate              applique ce qui manque
    python -m app.db.migrate --status     liste sans rien exécuter
    python -m app.db.migrate --baseline   marque tout comme appliqué, n'exécute rien

C'est l'unique étape impérative du déploiement : le pipeline la lance AVANT de
faire basculer le tag d'image, pendant que la version précédente sert encore,
et s'arrête si elle échoue — le schéma n'est donc jamais en retard sur le code
qui l'attend.

Les fichiers viennent de supabase/migrations/, copiés dans l'image à
/app/migrations (voir backend/Dockerfile). La même image sert l'API, l'ETL et
cette migration, donc le fichier exécuté est exactement celui qui a été
construit, scanné et signé.

BASELINE. Les migrations existantes ne sont pas idempotentes : elles créent des
policies et des triggers sans garde, ce qui échoue si l'objet est déjà là. La
base Supabase de ce projet les a toutes reçues à la main avant que ce runner
n'existe. Rejouer sur une base déjà peuplée casserait donc le déploiement au
lieu de le protéger. Quand la table de suivi est absente alors que le schéma
applicatif est déjà en place, ce script REFUSE de s'exécuter et demande un
baseline explicite ; il ne devine pas.
"""

from __future__ import annotations

import hashlib
import os
import pathlib
import sys

import psycopg2

MIGRATIONS_DIR = pathlib.Path(os.environ.get("MIGRATIONS_DIR", "/app/migrations"))

# Clé du verrou consultatif. Deux migrations concurrentes — un rollback lancé
# pendant qu'un déploiement tourne — se sérialisent au lieu de s'entrelacer.
LOCK_KEY = 8_147_293_006_112_004

# Sonde d'existence du schéma applicatif, pour distinguer « base neuve » de
# « base déjà migrée à la main ».
PROBE_TABLES = ("public.users", "public.notifications")


def log(message: str) -> None:
    print(message, flush=True)


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        log("DATABASE_URL est vide. Le secret database-url n'a pas été monté.")
        raise SystemExit(1)
    return url


def discover() -> list[pathlib.Path]:
    if not MIGRATIONS_DIR.is_dir():
        log(f"Répertoire de migrations introuvable : {MIGRATIONS_DIR}")
        raise SystemExit(1)
    # Tri lexical : c'est le préfixe numérique qui porte l'ordre, et deux
    # fichiers peuvent partager un numéro (001_create_users, 001_etl_dhis2) —
    # le nom complet les départage de façon stable.
    files = sorted(MIGRATIONS_DIR.glob("*.sql"), key=lambda p: p.name)
    if not files:
        log(f"Aucun fichier .sql dans {MIGRATIONS_DIR}")
        raise SystemExit(1)
    return files


def checksum(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ensure_table(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS public.schema_migrations (
            filename    text        PRIMARY KEY,
            checksum    text        NOT NULL,
            applied_at  timestamptz NOT NULL DEFAULT now()
        )
        """
    )


def schema_already_present(cur) -> bool:
    for table in PROBE_TABLES:
        cur.execute("SELECT to_regclass(%s) IS NOT NULL", (table,))
        if cur.fetchone()[0]:
            return True
    return False


def applied_map(cur) -> dict[str, str]:
    cur.execute("SELECT filename, checksum FROM public.schema_migrations")
    return dict(cur.fetchall())


def main() -> int:
    args = set(sys.argv[1:])
    status_only = "--status" in args
    baseline = "--baseline" in args or os.environ.get("MIGRATE_BASELINE") == "1"

    files = discover()
    conn = psycopg2.connect(database_url())
    conn.autocommit = True

    try:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_lock(%s)", (LOCK_KEY,))
            ensure_table(cur)
            done = applied_map(cur)

            # Base déjà migrée à la main, suivi vide : ne rien rejouer.
            if not done and not baseline and schema_already_present(cur):
                log(
                    "Le schéma applicatif existe déjà mais la table de suivi est vide.\n"
                    "Rejouer ces migrations échouerait (policies et triggers non idempotents).\n"
                    "Lancez une fois `python -m app.db.migrate --baseline` pour enregistrer\n"
                    "l'existant, puis les déploiements suivants n'appliqueront que le nouveau."
                )
                return 1

            pending = []
            for path in files:
                digest = checksum(path)
                previous = done.get(path.name)
                if previous is None:
                    pending.append((path, digest))
                elif previous != digest:
                    log(
                        f"{path.name} a été modifié après avoir été appliqué "
                        f"(empreinte {previous[:12]} → {digest[:12]}).\n"
                        "Une migration appliquée est immuable : ajoutez-en une nouvelle."
                    )
                    return 1

            log(f"{len(files)} migration(s) au total, {len(pending)} en attente.")

            if baseline:
                for path, digest in pending:
                    cur.execute(
                        "INSERT INTO public.schema_migrations (filename, checksum) "
                        "VALUES (%s, %s) ON CONFLICT (filename) DO NOTHING",
                        (path.name, digest),
                    )
                    log(f"  baseline  {path.name}")
                log("Baseline enregistré ; rien n'a été exécuté.")
                return 0

            if status_only:
                for path, _ in pending:
                    log(f"  en attente  {path.name}")
                return 0

            for path, digest in pending:
                log(f"  applique  {path.name}")
                sql = path.read_text(encoding="utf-8")
                # Une migration = une transaction : elle passe entièrement ou
                # ne laisse rien derrière elle.
                conn.autocommit = False
                try:
                    cur.execute(sql)
                    cur.execute(
                        "INSERT INTO public.schema_migrations (filename, checksum) VALUES (%s, %s)",
                        (path.name, digest),
                    )
                    conn.commit()
                except Exception as exc:  # noqa: BLE001 — on veut le message brut
                    conn.rollback()
                    log(f"ÉCHEC sur {path.name} : {exc}")
                    return 1
                finally:
                    conn.autocommit = True

            log("Migrations terminées." if pending else "Rien à faire, schéma à jour.")
            return 0
    finally:
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_unlock(%s)", (LOCK_KEY,))
        finally:
            conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
