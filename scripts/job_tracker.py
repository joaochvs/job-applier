#!/usr/bin/env python3
"""Create or update a CSV tracker for LinkedIn job applications."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path


FIELDS = [
    "fonte",
    "source_id",
    "linkedin_id",
    "url",
    "cargo",
    "empresa",
    "localizacao",
    "modelo",
    "tipo_candidatura",
    "publicada_em",
    "nota",
    "classificacao",
    "competencias_correspondentes",
    "lacunas",
    "status",
    "candidatura_em",
    "observacoes",
]

VALID_STATUS = {
    "Nova",
    "Selecionada",
    "Preparada",
    "Aguardando aprovação",
    "Enviada",
    "Entrevista",
    "Recusada",
    "Encerrada",
    "Descartada",
}


def load_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def save_rows(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows({field: row.get(field, "") for field in FIELDS} for row in rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", default="data/jobs.csv")
    parser.add_argument("--init", action="store_true")
    parser.add_argument("--upsert", action="store_true")
    for field in FIELDS:
        parser.add_argument(f"--{field.replace('_', '-')}", dest=field, default="")
    args = parser.parse_args()

    path = Path(args.file)
    rows = load_rows(path)

    if args.init:
        save_rows(path, rows)
        print(path.resolve())
        return

    if not args.upsert:
        parser.error("use --init or --upsert")

    item = {field: getattr(args, field) for field in FIELDS}
    if item["status"] and item["status"] not in VALID_STATUS:
        parser.error(f"invalid status: {item['status']}")
    if not item["source_id"] and not item["linkedin_id"] and not item["url"]:
        parser.error("--source-id, --linkedin-id or --url is required")

    match = next(
        (
            row
            for row in rows
            if (item["source_id"] and row.get("source_id") == item["source_id"])
            or (item["linkedin_id"] and row.get("linkedin_id") == item["linkedin_id"])
            or (item["url"] and row.get("url") == item["url"])
        ),
        None,
    )
    if match is None:
        if not item["status"]:
            item["status"] = "Nova"
        rows.append(item)
    else:
        for key, value in item.items():
            if value:
                match[key] = value

    save_rows(path, rows)
    print(path.resolve())


if __name__ == "__main__":
    main()
