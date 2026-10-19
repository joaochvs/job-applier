#!/usr/bin/env python3
"""Build and manage a human-reviewed job application queue."""

from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import datetime
from pathlib import Path


BLOCKED = {"Enviada", "Entrevista", "Recusada", "Encerrada", "Descartada"}
ELIGIBLE = {"Nova", "Selecionada", "Preparada", "Aguardando aprovação"}
VALID_STATUS = ELIGIBLE | BLOCKED


def load_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        raise SystemExit(f"tracker not found: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def save_rows(path: Path, rows: list[dict[str, str]]) -> None:
    if not rows:
        raise SystemExit("tracker has no rows")
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def score(row: dict[str, str]) -> int:
    try:
        return int(float(row.get("nota", "0") or 0))
    except ValueError:
        return 0


def identity(row: dict[str, str]) -> str:
    return row.get("source_id") or row.get("linkedin_id") or row.get("url", "")


def find(rows: list[dict[str, str]], key: str) -> dict[str, str]:
    key_fold = key.casefold()
    matches = [
        row for row in rows
        if key_fold in {
            identity(row).casefold(),
            row.get("url", "").casefold(),
            f"{row.get('empresa', '')}::{row.get('cargo', '')}".casefold(),
        }
    ]
    if not matches:
        raise SystemExit(f"job not found: {key}")
    if len(matches) > 1:
        raise SystemExit(f"ambiguous job key: {key}")
    return matches[0]


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-")
    return cleaned[:80] or "application"


def list_queue(rows: list[dict[str, str]], minimum: int, limit: int) -> None:
    queue = [r for r in rows if r.get("status", "Nova") in ELIGIBLE and score(r) >= minimum]
    queue.sort(key=score, reverse=True)
    payload = [
        {
            "id": identity(r),
            "score": score(r),
            "status": r.get("status", "Nova"),
            "cargo": r.get("cargo", ""),
            "empresa": r.get("empresa", ""),
            "fonte": r.get("fonte", ""),
            "url": r.get("url", ""),
            "lacunas": r.get("lacunas", ""),
        }
        for r in queue[:limit]
    ]
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def prepare(rows: list[dict[str, str]], key: str, output_dir: Path, resume: str, answers_path: Path) -> None:
    row = find(rows, key)
    if row.get("status") in BLOCKED:
        raise SystemExit(f"job is not eligible: {row.get('status')}")
    answer_bank = {}
    if answers_path.exists():
        answer_bank = json.loads(answers_path.read_text(encoding="utf-8"))
    dossier = {
        "schema_version": 1,
        "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "job": {
            "id": identity(row), "url": row.get("url", ""), "cargo": row.get("cargo", ""),
            "empresa": row.get("empresa", ""), "fonte": row.get("fonte", ""),
            "localizacao": row.get("localizacao", ""), "modelo": row.get("modelo", ""),
            "nota": score(row), "correspondencias": row.get("competencias_correspondentes", ""),
            "lacunas": row.get("lacunas", ""),
        },
        "resume": resume,
        "answer_bank": str(answers_path),
        "automatic_answers": answer_bank.get("keyword_answers", []),
        "known_profile": answer_bank.get("profile", {}),
        "answers": [],
        "unresolved": [
            "pretensão salarial, se obrigatória", "disponibilidade para início, se obrigatória",
            "regime contratual desejado, se obrigatório", "perguntas demográficas ou de deficiência",
            "autorização de trabalho ou visto para vagas fora do Brasil",
        ],
        "review": {"approved": False, "submitted": False, "submission_evidence": ""},
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / f"{safe_name(identity(row))}.json"
    target.write_text(json.dumps(dossier, ensure_ascii=False, indent=2), encoding="utf-8")
    print(target.resolve())


def review(path: Path) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    job = data["job"]
    result = {
        "cargo": job["cargo"], "empresa": job["empresa"], "url": job["url"],
        "nota": job["nota"], "curriculo": data.get("resume", ""),
        "respostas": data.get("answers", []), "pendencias": data.get("unresolved", []),
        "aprovada": data.get("review", {}).get("approved", False),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


def update_status(path: Path, rows: list[dict[str, str]], key: str, status: str) -> None:
    if status not in VALID_STATUS:
        raise SystemExit(f"invalid status: {status}")
    row = find(rows, key)
    row["status"] = status
    if status == "Enviada":
        row["candidatura_em"] = datetime.now().astimezone().date().isoformat()
    save_rows(path, rows)
    print(f"{identity(row)}: {status}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", default="data/jobs.csv")
    sub = parser.add_subparsers(dest="command", required=True)
    p_list = sub.add_parser("list")
    p_list.add_argument("--min-score", type=int, default=75)
    p_list.add_argument("--limit", type=int, default=10)
    p_prepare = sub.add_parser("prepare")
    p_prepare.add_argument("--job", required=True)
    p_prepare.add_argument("--output-dir", default="output/applications")
    p_prepare.add_argument("--resume", default="data/resume.pdf")
    p_prepare.add_argument("--answers", default="data/profile.json")
    p_review = sub.add_parser("review")
    p_review.add_argument("--dossier", required=True)
    p_status = sub.add_parser("status")
    p_status.add_argument("--job", required=True)
    p_status.add_argument("--set", required=True, dest="new_status")
    args = parser.parse_args()
    tracker = Path(args.file)
    if args.command == "review":
        review(Path(args.dossier))
        return
    rows = load_rows(tracker)
    if args.command == "list":
        list_queue(rows, args.min_score, args.limit)
    elif args.command == "prepare":
        prepare(rows, args.job, Path(args.output_dir), args.resume, Path(args.answers))
    else:
        update_status(tracker, rows, args.job, args.new_status)


if __name__ == "__main__":
    main()
