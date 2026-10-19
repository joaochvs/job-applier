"""Configuração local idempotente. Não abre navegador nem envia candidaturas."""
from __future__ import annotations
import argparse
import csv
import json
import os
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "scripts"))
from job_tracker import FIELDS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resume", type=Path, help="PDF a copiar para a pasta privada desta instalação")
    parser.add_argument("--check", action="store_true", help="Conferir configuração existente sem alterá-la")
    args = parser.parse_args()
    data = Path(os.environ.get("JOB_APPLIER_DATA_DIR", ROOT / "data")).resolve()
    automation = ROOT / "job-applier-app" / "automation.json"
    if args.check:
        problems = []
        for path in [data / "profile.json", data / "jobs.csv", data / "resume.pdf", automation]:
            if not path.is_file(): problems.append(f"Arquivo ausente: {path}")
        if (data / "profile.json").is_file():
            bank = json.loads((data / "profile.json").read_text(encoding="utf-8"))
            for key in ["full_name", "email", "phone"]:
                if not bank.get("profile", {}).get(key): problems.append(f"Preencha profile.{key} em profile.json")
        if problems:
            print("\n".join(problems))
            return 1
        print("Arquivos e contatos básicos configurados. Revise também conhecimentos e preferências antes de enviar.")
        return 0
    if args.resume and (not args.resume.is_file() or args.resume.read_bytes()[:5] != b"%PDF-"):
        parser.error("--resume precisa apontar para um PDF existente.")
    data.mkdir(parents=True, exist_ok=True)
    for source, target in [(ROOT / "examples/profile.example.json", data / "profile.json"),
                           (ROOT / "examples/automation.example.json", automation)]:
        if not target.exists():
            shutil.copyfile(source, target)
            print(f"Criado: {target}")
    tracker = data / "jobs.csv"
    if not tracker.exists():
        with tracker.open("w", encoding="utf-8-sig", newline="") as file:
            csv.DictWriter(file, fieldnames=FIELDS).writeheader()
    if args.resume:
        target = data / "resume.pdf"
        if target.exists():
            print("Currículo já existente preservado. Para substituir, copie o novo PDF manualmente para a pasta de dados.")
        else:
            shutil.copyfile(args.resume, target)
    print(f"Revise {data / 'profile.json'} e coloque seu currículo em {data / 'resume.pdf'}.")
    print("Agenda desativada por padrão em novas instalações. Leia docs/USO.md antes de iniciar envios.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
