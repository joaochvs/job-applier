"""Sobe somente o painel local, com fixture fictícia e agenda desativada."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import unittest
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


class PanelSmokeTests(unittest.TestCase):
    def test_dashboard_and_profile_api_without_private_files_or_browser(self):
        configuration = ROOT / "job-applier-app/automation.json"
        self.assertFalse(json.loads(configuration.read_text(encoding="utf-8"))["enabled"],
                         "Execute estes testes em instalação de desenvolvimento com agenda desativada.")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        env = dict(os.environ, JOB_APPLIER_PORT=str(port),
                   JOB_APPLIER_DATA_DIR=str(ROOT / "job-applier-app/fixtures"))
        process = subprocess.Popen([sys.executable, str(ROOT / "job-applier-app/app.py"), "--no-browser"],
                                   cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            deadline = time.monotonic() + 20
            while True:
                try:
                    with urlopen(f"http://127.0.0.1:{port}/api/profile", timeout=1) as response:
                        profile = json.load(response)
                    break
                except (URLError, TimeoutError):
                    if process.poll() is not None or time.monotonic() > deadline:
                        self.fail("Servidor local não iniciou.")
                    time.sleep(0.1)
            self.assertEqual(profile["profile"]["email"], "candidate@example.com")
            with urlopen(f"http://127.0.0.1:{port}/", timeout=2) as response:
                self.assertIn("Job Applier", response.read().decode("utf-8"))
            with urlopen(f"http://127.0.0.1:{port}/api/jobs", timeout=2) as response:
                self.assertEqual(json.load(response)["jobs"], [])
        finally:
            process.terminate()
            process.wait(timeout=10)
            process.stderr.close()


if __name__ == "__main__":
    unittest.main()
