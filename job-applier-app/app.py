from __future__ import annotations

import csv
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import unicodedata
import webbrowser
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


APP_DIR = Path(__file__).resolve().parent
ROOT = APP_DIR.parent
DATA_DIR = Path(os.environ.get("JOB_APPLIER_DATA_DIR", ROOT / "data")).resolve()
TRACKER = DATA_DIR / "jobs.csv"
RESUME = DATA_DIR / "resume.pdf"
ANSWERS = DATA_DIR / "profile.json"
DOSSIERS = ROOT / "output" / "applications"
STATIC = APP_DIR / "static"
RUNTIME = APP_DIR / "runtime"
WORKER = APP_DIR / "worker.js"
SCOUT = APP_DIR / "scout.js"
QUEUE_SCRIPT = ROOT / "scripts" / "application_queue.py"
BATCH_PROCESS = None
SEARCH_PROCESS = None
BATCH_GUARD = threading.Lock()
ANSWER_GUARD = threading.Lock()


def batch_busy():
    return (RUNTIME / "automatic.lock").exists() or (BATCH_PROCESS is not None and BATCH_PROCESS.poll() is None)


def start_batch(manual=False, key=None, retry_pending=False):
    global BATCH_PROCESS
    with BATCH_GUARD:
        if batch_busy():
            raise ValueError("Já existe uma execução automática em andamento.")
        if SEARCH_PROCESS is not None and SEARCH_PROCESS.poll() is None:
            raise ValueError("A busca de vagas ainda está usando o navegador. Aguarde terminar.")
        RUNTIME.mkdir(exist_ok=True)
        args = [sys.executable, str(APP_DIR / "daily.py"), "--run"]
        if manual:
            args.append("--manual")
        if key:
            args.extend(["--job", key])
        if retry_pending:
            args.append("--retry-pending")
        (RUNTIME / "automatic.stop").unlink(missing_ok=True)
        (RUNTIME / "events.jsonl").write_text("", encoding="utf-8")
        (RUNTIME / "session.json").write_text(json.dumps({"mode":"automatic", "started_at":datetime.now(timezone.utc).isoformat()}), encoding="utf-8")
        (RUNTIME / "search.json").write_text(json.dumps({"status": "idle"}), encoding="utf-8")
        (RUNTIME / "automatic.json").write_text(json.dumps({"status": "starting", "applications": []}), encoding="utf-8")
        with (RUNTIME / "automatic.log").open("a", encoding="utf-8") as log:
            BATCH_PROCESS = subprocess.Popen(args, cwd=APP_DIR, stdout=log, stderr=subprocess.STDOUT,
                                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def node_binary() -> str:
    binary = os.environ.get("JOB_APPLIER_NODE") or shutil.which("node")
    bundled = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe"
    if binary:
        return binary
    if bundled.is_file():
        return str(bundled)
    raise ValueError("Node.js não encontrado. Configure JOB_APPLIER_NODE.")

VALID_STATUS = {
    "Nova", "Selecionada", "Preparada", "Aguardando aprovação", "Enviada",
    "Entrevista", "Recusada", "Encerrada", "Descartada",
}


def read_rows() -> list[dict[str, str]]:
    if not TRACKER.exists():
        return []
    with TRACKER.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_rows(rows: list[dict[str, str]]) -> None:
    if not rows:
        return
    temp = TRACKER.with_suffix(".csv.tmp")
    with temp.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    temp.replace(TRACKER)


def job_id(row: dict[str, str]) -> str:
    return row.get("source_id") or row.get("linkedin_id") or row.get("url", "")


def score(row: dict[str, str]) -> int:
    try:
        return int(float(row.get("nota", 0) or 0))
    except ValueError:
        return 0


def eligible_quick_job(item: dict) -> bool:
    try:
        return (int(item.get("nota", 0) or 0) >= 75
                and item.get("tipo_candidatura") in {"LinkedIn Simplificada", "Indeed Fácil"}
                and not item.get("lacunas"))
    except (TypeError, ValueError):
        return False


def public_job(row: dict[str, str]) -> dict:
    item = dict(row)
    item["id"] = job_id(row)
    item["nota"] = score(row)
    dossier = DOSSIERS / f"{item['id']}.json"
    item["dossier_exists"] = dossier.exists()
    kind = (row.get("tipo_candidatura") or "").strip()
    notes = (row.get("observacoes") or "").casefold()
    if not kind and "candidatura simplificada" in notes:
        kind = "LinkedIn Simplificada"
    if not kind and "candidate-se facilmente" in notes:
        kind = "Indeed Fácil"
    item["tipo_candidatura"] = kind or "Não identificado"
    item["easy_apply"] = item["tipo_candidatura"] in {"LinkedIn Simplificada", "Indeed Fácil"}
    state = read_state(RUNTIME / f"{item['id']}.json", {})
    item["pending_questions"] = state.get("unknown", [])
    item["pending_fields"] = state.get("fields", [])
    item["pending_revision"] = state.get("updatedAt", "")
    item["resume_queued"] = item["id"] in read_state(RUNTIME / "answer-resume-queue.json", [])
    item["worker_message"] = state.get("message", "")
    item["retryable"] = (row.get("status") == "Aguardando aprovação" and item["tipo_candidatura"] == "LinkedIn Simplificada"
                         and eligible_quick_job(row) and state.get("status") in {"error", "needs_input", "cancelled"}
                         and not (RUNTIME / f"{item['id']}.submission.json").exists())
    return item


def find_job(key: str) -> tuple[list[dict[str, str]], dict[str, str]]:
    rows = read_rows()
    for row in rows:
        if key in {job_id(row), row.get("url", "")}:
            return rows, row
    raise KeyError(key)


def read_answers() -> dict:
    return json.loads(ANSWERS.read_text(encoding="utf-8"))


def normalized_question(value):
    return " ".join("".join(c for c in unicodedata.normalize("NFD", value) if not unicodedata.combining(c)).lower().split())


def job_specific_question(question):
    return bool(re.search(r"salari|salary|remunera|pretensao|presencial|onsite|on.site|hibrid|hybrid|relocat|mudanca|disponib|availability|aceita|accept|viage|viajar|interess|interested", normalized_question(question)))


def atomic_json(path, data):
    path.parent.mkdir(exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def save_pending_answers(key, body):
    if not key.isdigit():
        raise ValueError("Vaga inválida.")
    with ANSWER_GUARD:
        _, row = find_job(key)
        item = public_job(row)
        state = read_state(RUNTIME / f"{key}.json", {})
        if not item["retryable"] or state.get("status") != "needs_input":
            raise ValueError("Esta candidatura não está aguardando respostas ou já tem uma tentativa de envio.")
        fields = {f["question"]: f for f in state.get("fields", []) if f.get("type") in {"text", "number", "choice"}}
        incoming = body.get("answers")
        if not isinstance(incoming, list) or not incoming or len(incoming) > 100:
            raise ValueError("Informe as respostas das perguntas pendentes.")
        validated = []
        seen = set()
        for entry in incoming:
            if not isinstance(entry, dict):
                raise ValueError("Resposta inválida.")
            question, answer = entry.get("question"), entry.get("answer")
            if not isinstance(question, str) or question not in fields or question in seen:
                raise ValueError("Pergunta não pertence ao formulário pendente. Retome para atualizar os campos.")
            field = fields[question]
            if not isinstance(answer, str) or not answer.strip() or len(answer) > min(field.get("max_length", 4000), 4000):
                raise ValueError("Preencha uma resposta válida, respeitando o limite do campo.")
            answer = answer.strip()
            if field.get("error") and answer == str(field.get("previous_answer", "")).strip():
                raise ValueError("Esta resposta já foi rejeitada pelo LinkedIn. Informe um novo valor.")
            if field["type"] == "choice" and answer not in field.get("options", []):
                raise ValueError("Escolha uma das opções disponíveis na vaga.")
            if field["type"] == "number" and not re.fullmatch(r"[+-]?(?:\d+(?:\.\d+)?|\.\d+)", answer):
                raise ValueError("Este campo precisa de um número.")
            reuse = entry.get("remember") is True and not job_specific_question(question)
            validated.append({"question": question, "answer": answer, "job_id": None if reuse else key,
                              "source": "Resposta informada pelo usuário no painel", "updated_at": datetime.now(timezone.utc).isoformat()})
            seen.add(question)
        if seen != set(fields):
            raise ValueError("Responda todos os campos disponíveis antes de continuar.")
        data = read_answers()
        custom = data.setdefault("custom_answers", [])
        for entry in validated:
            custom[:] = [a for a in custom if not (normalized_question(a["question"]) == normalized_question(entry["question"]) and a.get("job_id") in {entry["job_id"], key})]
            custom.append(entry)
        atomic_json(ANSWERS, data)
        queue_path = RUNTIME / "answer-resume-queue.json"
        queue = read_state(queue_path, [])
        if key not in queue:
            queue.append(key)
        atomic_json(queue_path, queue)
        return {"ok": True, "status": "queued", "saved": len(validated)}


def process_answer_queue():
    with ANSWER_GUARD:
        queue_path = RUNTIME / "answer-resume-queue.json"
        queue = read_state(queue_path, [])
        if not queue or batch_busy() or (SEARCH_PROCESS is not None and SEARCH_PROCESS.poll() is None):
            return
        key = queue[0]
        try:
            _, row = find_job(key)
            if public_job(row)["retryable"]:
                start_batch(manual=True, key=key, retry_pending=True)
        except KeyError:
            pass
        atomic_json(queue_path, queue[1:])


def answer_queue_loop():
    while True:
        try:
            process_answer_queue()
        except (OSError, ValueError) as error:
            print(f"Retomada de candidatura: {error}")
        threading.Event().wait(2)


def read_state(path, default):
    # A leitura pode coincidir com a gravação de um worker; tente no próximo poll.
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def live_snapshot():
    config = read_state(APP_DIR / "automation.json", {})
    run = read_state(RUNTIME / "automatic.json", {"status": "idle", "applications": []})
    run["active"] = batch_busy()
    search = read_state(RUNTIME / "search.json", {"status": "idle"})
    search_active = SEARCH_PROCESS is not None and SEARCH_PROCESS.poll() is None
    if not run["active"] and run.get("status") in {"running", "starting"}:
        run.update(status="error", message="A execução foi interrompida. Confira o histórico antes de tentar novamente.")
    events = []
    try:
        for line in (RUNTIME / "events.jsonl").read_text(encoding="utf-8").splitlines()[-160:]:
            try:
                events.append(json.loads(line))
            except ValueError:
                continue
    except OSError:
        pass
    active_job = next((x for x in run.get("applications", []) if x.get("status") == "starting"), None)
    worker = read_state(RUNTIME / f"{active_job['id']}.json", {}) if active_job else {}
    return dict(run=run, search=search, search_active=search_active, events=events,
                session=read_state(RUNTIME / "session.json", {"mode":"automatic"}),
                audit=read_state(RUNTIME / "search-audit.json", []), worker=worker,
                config=config, updated_at=datetime.now(timezone.utc).isoformat())


def daily_scheduler() -> None:
    """Roda enquanto o servidor está aberto; um lote por dia, sem agendador externo."""
    last_started = None
    while True:
        try:
            config = json.loads((APP_DIR / "automation.json").read_text(encoding="utf-8"))
            now = datetime.now(timezone(timedelta(hours=-3)))
            day = now.date().isoformat()
            if (config.get("enabled") and (now.hour, now.minute) >= (config["hour"], config["minute"])
                    and last_started != day and not (ROOT / "output" / "daily-runs" / f"{day}.json").exists()
                    and not (RUNTIME / "automatic.lock").exists()):
                start_batch()
                last_started = day
        except (OSError, ValueError, KeyError) as error:
            print(f"Agendamento de vagas: {error}")
        threading.Event().wait(20)


def read_json_body(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", 0))
    if length > 1_000_000:
        raise ValueError("request too large")
    return json.loads(handler.rfile.read(length) or b"{}")


class Handler(BaseHTTPRequestHandler):
    server_version = "JobApplier/0.1"

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {fmt % args}")

    def send_json(self, data, status=HTTPStatus.OK) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def send_error_json(self, message: str, status=HTTPStatus.BAD_REQUEST) -> None:
        self.send_json({"ok": False, "error": message}, status)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/live":
            self.send_json(live_snapshot())
            return
        if parsed.path == "/api/runs":
            reports = []
            directory = ROOT / "output" / "daily-runs"
            for path in sorted(directory.glob("*.json"), key=lambda p:p.stat().st_mtime, reverse=True)[:30]:
                report = read_state(path, {})
                if report.get("status") == "manual_run":
                    continue
                reports.append(dict(report, file=path.name))
            self.send_json({"runs": reports})
            return
        if parsed.path == "/api/jobs":
            rows = sorted(read_rows(), key=score, reverse=True)
            self.send_json({"jobs": [public_job(row) for row in rows]})
            return
        if parsed.path == "/api/summary":
            rows = read_rows()
            counts = {status: 0 for status in VALID_STATUS}
            for row in rows:
                counts[row.get("status", "Nova")] = counts.get(row.get("status", "Nova"), 0) + 1
            self.send_json({
                "total": len(rows),
                "priority": sum(score(row) >= 75 for row in rows),
                "ready": counts.get("Aguardando aprovação", 0),
                "sent": counts.get("Enviada", 0),
                "easy_apply": sum(public_job(row)["easy_apply"] for row in rows),
                "counts": counts,
            })
            return
        if parsed.path == "/api/profile":
            data = read_answers()
            self.send_json({"profile": data.get("profile", {}), "skills": data.get("skills", {}), "defaults": data.get("always_ask", {}), "learned_answers": data.get("custom_answers", [])})
            return
        if parsed.path.startswith("/api/dossier/"):
            key = parsed.path.rsplit("/", 1)[-1]
            path = DOSSIERS / f"{key}.json"
            if not path.exists():
                self.send_error_json("Dossiê ainda não preparado", HTTPStatus.NOT_FOUND)
                return
            self.send_json(json.loads(path.read_text(encoding="utf-8")))
            return
        if parsed.path.startswith("/api/worker/"):
            key = parsed.path.rsplit("/", 1)[-1]
            state = RUNTIME / f"{key}.json"
            self.send_json(json.loads(state.read_text(encoding="utf-8")) if state.exists() else {"jobId": key, "status": "idle"})
            return
        if parsed.path == "/api/search/status":
            state = RUNTIME / "search.json"
            self.send_json(json.loads(state.read_text(encoding="utf-8")) if state.exists() else {"status": "idle"})
            return
        if parsed.path == "/api/search/audit":
            audit = RUNTIME / "search-audit.json"
            self.send_json({"jobs": json.loads(audit.read_text(encoding="utf-8")) if audit.exists() else []})
            return
        if parsed.path == "/api/automatic/status":
            state = RUNTIME / "automatic.json"
            data = json.loads(state.read_text(encoding="utf-8")) if state.exists() else {"status": "idle", "applications": []}
            data["active"] = batch_busy()
            config = json.loads((APP_DIR / "automation.json").read_text(encoding="utf-8"))
            data["schedule"] = {k: config[k] for k in ("enabled", "hour", "minute")}
            if not data["active"] and data["status"] in {"starting", "running"}:
                data.update(status="error", message="A execução foi interrompida. Consulte o registro da rotina antes de tentar novamente.")
            self.send_json(data)
            return
        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        global SEARCH_PROCESS
        parsed = urlparse(self.path)
        try:
            body = read_json_body(self)
            if parsed.path == "/api/automatic/start":
                start_batch(manual=True)
                self.send_json({"ok": True, "status": "starting"})
                return
            if parsed.path == "/api/automatic/retry":
                start_batch(manual=True, retry_pending=True)
                self.send_json({"ok": True, "status": "starting"})
                return
            if parsed.path == "/api/automatic/stop":
                with ANSWER_GUARD:
                    atomic_json(RUNTIME / "answer-resume-queue.json", [])
                if batch_busy() or (SEARCH_PROCESS is not None and SEARCH_PROCESS.poll() is None):
                    (RUNTIME / "automatic.stop").write_text("stop", encoding="utf-8")
                self.send_json({"ok": True})
                return
            if parsed.path.startswith("/api/jobs/") and parsed.path.endswith("/answers"):
                key = parsed.path.split("/")[3]
                self.send_json(save_pending_answers(key, body))
                return
            if parsed.path.startswith("/api/jobs/") and parsed.path.endswith("/status"):
                key = parsed.path.split("/")[3]
                status = body.get("status", "")
                if status not in VALID_STATUS:
                    raise ValueError("Status inválido")
                rows, row = find_job(key)
                row["status"] = status
                if status == "Enviada" and not row.get("candidatura_em"):
                    row["candidatura_em"] = datetime.now().date().isoformat()
                write_rows(rows)
                self.send_json({"ok": True, "job": public_job(row)})
                return
            if parsed.path.startswith("/api/jobs/") and parsed.path.endswith("/prepare"):
                key = parsed.path.split("/")[3]
                result = subprocess.run(
                    [sys.executable, str(QUEUE_SCRIPT), "--file", str(TRACKER), "prepare", "--job", key,
                     "--output-dir", str(DOSSIERS), "--resume", str(RESUME),
                     "--answers", str(ANSWERS)],
                    cwd=ROOT, capture_output=True, text=True, timeout=20,
                )
                if result.returncode:
                    raise ValueError(result.stderr.strip() or result.stdout.strip())
                rows, row = find_job(key)
                row["status"] = "Preparada"
                write_rows(rows)
                self.send_json({"ok": True, "dossier": result.stdout.strip(), "job": public_job(row)})
                return
            if parsed.path.startswith("/api/jobs/") and parsed.path.endswith("/apply"):
                key = parsed.path.split("/")[3]
                rows, row = find_job(key)
                item = public_job(row)
                if batch_busy():
                    raise ValueError("A rotina automática está usando o navegador. Aguarde terminar.")
                if row.get("status") in {"Enviada", "Entrevista", "Recusada", "Encerrada", "Descartada"}:
                    raise ValueError("Esta vaga não está elegível para candidatura")
                if not eligible_quick_job(row) or item["tipo_candidatura"] != "LinkedIn Simplificada":
                    raise ValueError("O envio automático exige LinkedIn Simplificada, nota mínima 75 e nenhuma lacuna registrada.")
                start_batch(manual=True, key=key, retry_pending=True)
                self.send_json({"ok": True, "status": "starting"})
                return
            if parsed.path.startswith("/api/jobs/") and parsed.path.endswith("/submit"):
                key = parsed.path.split("/")[3]
                _, row = find_job(key)
                state_path = RUNTIME / f"{key}.json"
                state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
                if row.get("status") in {"Enviada", "Entrevista", "Recusada", "Encerrada", "Descartada"} or state.get("status") != "awaiting_confirmation":
                    raise ValueError("Não há candidatura aguardando confirmação para esta vaga")
                RUNTIME.mkdir(exist_ok=True)
                (RUNTIME / f"{key}.command.json").write_text(json.dumps({"action": "submit"}), encoding="utf-8")
                self.send_json({"ok": True})
                return
            if parsed.path == "/api/search/start":
                with BATCH_GUARD:
                    if batch_busy() or (SEARCH_PROCESS is not None and SEARCH_PROCESS.poll() is None):
                        raise ValueError("Já há uma busca ou candidatura usando o navegador. Aguarde terminar.")
                    RUNTIME.mkdir(exist_ok=True)
                    (RUNTIME / "automatic.stop").unlink(missing_ok=True)
                    (RUNTIME / "events.jsonl").write_text("", encoding="utf-8")
                    (RUNTIME / "session.json").write_text(json.dumps({"mode":"search", "started_at":datetime.now(timezone.utc).isoformat()}), encoding="utf-8")
                    (RUNTIME / "search.json").write_text(json.dumps({"status": "starting"}), encoding="utf-8")
                    SEARCH_PROCESS = subprocess.Popen([node_binary(), str(SCOUT)], cwd=APP_DIR, creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
                self.send_json({"ok": True, "status": "starting"})
                return
            if parsed.path == "/api/search/import":
                results = RUNTIME / "search-results.json"
                if not results.exists():
                    raise ValueError("A busca ainda não produziu resultados")
                discovered = json.loads(results.read_text(encoding="utf-8"))
                incoming = [item for item in discovered if eligible_quick_job(item)]
                rows = read_rows()
                existing = {job_id(row) for row in rows}
                if not incoming:
                    self.send_json({"ok": True, "added": 0, "found": len(discovered), "eligible": 0})
                    return
                fields = list(rows[0]) if rows else list(incoming[0])
                added = 0
                for item in incoming:
                    if item.get("source_id") in existing:
                        continue
                    rows.append({field: item.get(field, "") for field in fields})
                    existing.add(item.get("source_id")); added += 1
                write_rows(rows)
                self.send_json({"ok": True, "added": added, "found": len(discovered), "eligible": len(incoming)})
                return
            self.send_error_json("Rota não encontrada", HTTPStatus.NOT_FOUND)
        except KeyError:
            self.send_error_json("Vaga não encontrada", HTTPStatus.NOT_FOUND)
        except (ValueError, json.JSONDecodeError, subprocess.TimeoutExpired) as exc:
            self.send_error_json(str(exc))

    def serve_static(self, path: str) -> None:
        relative = "index.html" if path in {"", "/"} else path.lstrip("/")
        target = (STATIC / relative).resolve()
        if STATIC.resolve() not in target.parents and target != STATIC.resolve():
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        if not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        payload = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)


def main() -> None:
    host = "127.0.0.1"
    port = int(os.environ.get("JOB_APPLIER_PORT", "8765"))
    server = ThreadingHTTPServer((host, port), Handler)
    url = f"http://{host}:{port}"
    print(f"Aplicador de vagas disponível em {url}")
    threading.Thread(target=daily_scheduler, daemon=True).start()
    threading.Thread(target=answer_queue_loop, daemon=True).start()
    if "--no-browser" not in sys.argv:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nAplicação encerrada.")


if __name__ == "__main__":
    main()
