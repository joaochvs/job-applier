import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("local_setup", ROOT / "setup.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupTests(unittest.TestCase):
    def test_fresh_setup_is_local_disabled_and_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "examples").mkdir()
            (root / "job-applier-app").mkdir()
            for name in ["profile.example.json", "automation.example.json"]:
                (root / "examples" / name).write_bytes((ROOT / "examples" / name).read_bytes())
            with patch.object(setup, "ROOT", root), patch.dict(setup.os.environ, {"JOB_APPLIER_DATA_DIR": str(root / "private")}), patch("sys.argv", ["setup.py"]), patch("builtins.print"):
                self.assertEqual(setup.main(), 0)
                self.assertFalse(json.loads((root / "job-applier-app/automation.json").read_text())["enabled"])
                profile = root / "private/profile.json"
                profile.write_text('{"profile":{"full_name":"Custom"}}', encoding="utf-8")
                self.assertEqual(setup.main(), 0)
                self.assertEqual(json.loads(profile.read_text())["profile"]["full_name"], "Custom")


if __name__ == "__main__":
    unittest.main()
