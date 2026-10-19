"""Busca e envio automático de candidaturas simplificadas, uma por vez.

Sem --run executa somente simulação local, sem navegador ou gravações.
"""
from __future__ import annotations
import argparse
import csv
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import unicodedata
import uuid

APP = Path(__file__).resolve().parent
ROOT = APP.parent
RUNTIME = APP / "runtime"
TRACKER = Path(os.environ.get("JOB_APPLIER_DATA_DIR", ROOT / "data")).resolve() / "jobs.csv"
BRAZIL = timezone(timedelta(hours=-3), "America/Sao_Paulo")
BLOCKED = {"Enviada", "Entrevista", "Recusada", "Encerrada", "Descartada", "Aguardando aprovação"}
sys.path.insert(0, str(ROOT / "scripts"))
import job_tracker


def node_binary():
    binary = os.environ.get("JOB_APPLIER_NODE") or shutil.which("node")
    bundled = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe"
    if binary:
        return binary
    if bundled.is_file():
        return str(bundled)
    raise RuntimeError("Node.js não encontrado. Configure JOB_APPLIER_NODE.")


def normalized(value):
    return " ".join("".join(c for c in unicodedata.normalize("NFKD", value or "").casefold() if not unicodedata.combining(c)).split())


def same_job(a, b):
    if a.get("url") and a["url"].rstrip("/") == b.get("url", "").rstrip("/"):
        return True
    if a.get("source_id") and a["source_id"] == (b.get("source_id") or b.get("linkedin_id")):
        return True
    return all(normalized(a.get(k)) and normalized(a.get(k)) == normalized(b.get(k)) for k in ("empresa", "cargo", "localizacao"))


def eligible(item, minimum):
    try:
        return (float(item.get("nota", 0)) >= minimum and item.get("tipo_candidatura") == "LinkedIn Simplificada"
                and not item.get("lacunas") and item.get("empresa") and item["empresa"] != "Empresa não identificada"
                and str(item.get("source_id", "")).isdigit())
    except (ValueError, TypeError):
        return False


def select_jobs(items, rows, config, retry_pending=False):
    chosen = []
    for item in sorted(items, key=lambda x: job_tracker_score(x), reverse=True):
        if not eligible(item, config["min_score"]):
            continue
        previous = [row for row in rows if same_job(item, row)]
        blocked = BLOCKED - {"Aguardando aprovação"} if retry_pending else BLOCKED
        if any(row.get("status") in blocked for row in previous) or any(same_job(item, other) for other in chosen):
            continue
        if (RUNTIME / f"{item['source_id']}.submission.json").exists():
            continue
        chosen.append(item)
        if len(chosen) >= config["max_applications"]:
            break
    return chosen


def job_tracker_score(item):
    try:
        return float(item.get("nota", 0) or 0)
    except (TypeError, ValueError):
        return 0


def event(stage, message, **extra):
    with (RUNTIME / "events.jsonl").open("a", encoding="utf-8") as log:
        log.write(json.dumps(dict(at=datetime.now(timezone.utc).isoformat(), stage=stage, message=message, **extra), ensure_ascii=False)+"\n")


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true", help="Executar busca e envios reais")
    parser.add_argument("--manual", action="store_true", help="Lote iniciado pelo painel, independente do horário")
    parser.add_argument("--job", help="Uma vaga elegível já cadastrada, iniciada pelo painel")
    parser.add_argument("--retry-pending", action="store_true", help="Retomar pendentes sem tentativa anterior de envio")
    args = parser.parse_args()
    config = json.loads((APP / "automation.json").read_text(encoding="utf-8"))
    rows = job_tracker.load_rows(TRACKER)
    if not args.run:
        items = json.loads((RUNTIME / "search-results.json").read_text(encoding="utf-8")) if (RUNTIME / "search-results.json").exists() else []
        print(json.dumps({"dry_run": True, "enabled": config["enabled"], "schedule": f"{config.get('hour', 11):02d}:{config.get('minute', 0):02d} America/Sao_Paulo", "candidates": [j["source_id"] for j in select_jobs(items, rows, config)], "warning": "Simulação; resultados locais podem estar antigos. Nenhum navegador aberto ou envio realizado."}, ensure_ascii=False, indent=2))
        return
    if not config["enabled"] and not args.manual:
        return
    RUNTIME.mkdir(exist_ok=True)
    day = datetime.now(BRAZIL).date().isoformat()
    output = ROOT / "output" / "daily-runs"
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / (f"{day}-{uuid.uuid4().hex[:8]}.json" if args.manual else f"{day}.json")
    # Nunca execute duas rotinas em paralelo, nem repita automaticamente o mesmo dia.
    if report_path.exists():
        return
    lock = RUNTIME / "automatic.lock"
    try:
        handle = lock.open("x", encoding="utf-8")
    except FileExistsError:
        raise SystemExit("Outra execução está ativa ou deixou um lock para revisão.")
    with handle:
        handle.write(str(os.getpid()))
    stop = RUNTIME / "automatic.stop"
    report = {"date": day, "status": "running", "applications": []}
    if args.manual:
        # O lote manual também ocupa a execução agendada do dia; evita outro
        # lote disparado pelo agendador logo após o usuário interromper este.
        try:
            with (output / f"{day}.json").open("x", encoding="utf-8") as marker:
                json.dump({"date": day, "status": "manual_run", "report": report_path.name}, marker)
        except FileExistsError:
            pass
    report_path.write_text(json.dumps(report), encoding="utf-8")
    def save_report():
        report["updatedAt"] = datetime.now(timezone.utc).isoformat()
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        (RUNTIME / "automatic.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    save_report()
    event("run_start", "Execução iniciada: busca e envio automático" if not args.job else "Candidatura individual iniciada")
    try:
        node = node_binary()
        search_state = {}
        if args.job:
            items = [row for row in rows if (row.get("source_id") or row.get("linkedin_id")) == args.job]
        elif args.retry_pending:
            items = [row for row in rows if row.get("status") == "Aguardando aprovação"]
        else:
            report["phase"] = "searching"
            save_report()
            started = datetime.now(timezone.utc)
            subprocess.run([node, str(APP / "scout.js")], cwd=APP, check=True, timeout=2400)
            if stop.exists():
                report["status"] = "stopped"
                return
            state = json.loads((RUNTIME / "search.json").read_text(encoding="utf-8"))
            search_state = state
            if state.get("status") != "completed" or datetime.fromisoformat(state["updatedAt"].replace("Z", "+00:00")) < started:
                raise RuntimeError(state.get("message", "Busca incompleta ou antiga; nenhum envio executado."))
            items = json.loads((RUNTIME / "search-results.json").read_text(encoding="utf-8"))
        selected = select_jobs(items, rows, config, retry_pending=args.retry_pending)
        report["found"] = search_state.get("found", len(items))
        report["evaluated"] = search_state.get("evaluated", search_state.get("found", len(items)))
        report["eligible"] = len(items)
        report["selected"] = len(selected)
        report["phase"] = "applying"
        event("selection", f"{len(selected)} vagas selecionadas para candidatura")
        if not selected:
            report["message"] = ("Nenhuma vaga passou pela triagem; nenhuma candidatura foi enviada. Consulte os motivos em Ver análise das vagas."
                                  if not items else "As vagas compatíveis já foram processadas ou possuem pendências; nenhum novo envio foi iniciado.")
        save_report()
        for item in selected:
            if stop.exists():
                break
            rows = job_tracker.load_rows(TRACKER)
            if not select_jobs([item], rows, config, retry_pending=args.retry_pending):
                continue
            row = next((row for row in rows if same_job(item, row)), None)
            if row is None:
                row = {field: item.get(field, "") for field in job_tracker.FIELDS}
                rows.append(row)
            job_tracker.save_rows(TRACKER, rows)
            key = item["source_id"]
            entry = {"id": key, "company": item["empresa"], "title": item["cargo"], "url": item["url"], "status": "starting"}
            report["applications"].append(entry)
            event("application", f"Iniciando {item['cargo']} · {item['empresa']}", jobId=key)
            save_report()
            state_path = RUNTIME / f"{key}.json"
            try:
                subprocess.run([node, str(APP / "worker.js"), key, item["url"], "--auto-submit"], cwd=APP, check=True, timeout=300)
                state = json.loads(state_path.read_text(encoding="utf-8"))
                entry.update(status=state["status"], message=state.get("message", ""), unknown=state.get("unknown", []))
            except (subprocess.SubprocessError, OSError, ValueError) as error:
                entry.update(status="submit_uncertain", message=str(error))
            # Releia para preservar alterações manuais feitas durante o preenchimento.
            rows = job_tracker.load_rows(TRACKER)
            row = next(row for row in rows if same_job(item, row))
            if entry["status"] in {"submitted", "already_applied"}:
                row["status"] = "Enviada"
                row["candidatura_em"] = day
            else:
                row["status"] = "Aguardando aprovação"
            row["observacoes"] = f"{row.get('observacoes', '')}; rotina {day}: {entry['status']} {entry.get('message', '')}"
            job_tracker.save_rows(TRACKER, rows)
            save_report()
            if entry["status"] in {"needs_login", "submit_uncertain"}:
                break
        report["status"] = "stopped" if stop.exists() else "completed"
    except Exception as error:
        report.update(status="error", message=str(error))
    finally:
        save_report()
        event(report["status"], report.get("message") or {"completed":"Execução concluída", "stopped":"Execução interrompida", "error":"Execução encerrada com erro"}.get(report["status"],"Execução finalizada"))
        lock.unlink(missing_ok=True)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    run()
