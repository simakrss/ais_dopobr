import contextlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import ensure_runtime as bootstrap


class RuntimeBootstrapTests(unittest.TestCase):
    def test_ready_base_needs_no_install_or_network(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(bootstrap, "probe", return_value=True) as probe, patch.object(bootstrap, "run") as run:
            root = Path(temporary)
            self.assertTrue(bootstrap.ensure_runtime(root, "revision"))
            self.assertEqual(json.loads((root / "state.json").read_text())["mode"], "base")
            run.assert_not_called()
            probe.assert_called_once_with(bootstrap.sys.executable)

    def test_missing_dependencies_install_and_verify(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(bootstrap, "probe", side_effect=[False, False, True, True]) as probe, patch.object(bootstrap.venv, "EnvBuilder") as builder, patch.object(bootstrap, "run") as run:
            root = Path(temporary)
            self.assertTrue(bootstrap.ensure_runtime(root, "revision"))
            state = json.loads((root / "state.json").read_text())
            self.assertEqual(state["status"], "ready")
            self.assertEqual(state["mode"], "managed")
            builder.assert_called_once_with(with_pip=True)
            command = [str(part) for part in run.call_args.args[0]]
            self.assertIn("--isolated", command)
            self.assertIn("https://pypi.org/simple", command)
            self.assertNotIn("--user", command)
            self.assertEqual(sum(bool(call.kwargs.get("download")) for call in probe.call_args_list), 1)

    def test_installed_environment_is_reused(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(bootstrap, "probe", side_effect=[False, True]), patch.object(bootstrap.venv, "EnvBuilder") as builder:
            root = Path(temporary)
            python = root / "venv" / ("Scripts/python.exe" if bootstrap.os.name == "nt" else "bin/python")
            python.parent.mkdir(parents=True)
            python.touch()
            self.assertTrue(bootstrap.ensure_runtime(root, "revision"))
            builder.assert_not_called()

    def test_failed_install_does_not_claim_ready(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(bootstrap, "probe", return_value=False), patch.object(bootstrap.venv, "EnvBuilder"), patch.object(bootstrap, "run", side_effect=subprocess.TimeoutExpired("pip", 900)):
            root = Path(temporary)
            self.assertFalse(bootstrap.ensure_runtime(root, "revision"))
            state = json.loads((root / "state.json").read_text())
            self.assertEqual(state["status"], "failed")
            self.assertNotIn("mode", state)
            self.assertNotIn("pip", state["error"])

    def test_damaged_models_are_backed_up_before_download(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(bootstrap, "probe", side_effect=[False, False, True, True]), patch.object(bootstrap.venv, "EnvBuilder"), patch.object(bootstrap, "run"):
            root = Path(temporary)
            (root / "models").mkdir()
            (root / "models" / "corrupted.onnx").write_bytes(b"old")
            self.assertTrue(bootstrap.ensure_runtime(root, "revision"))
            backups = list(root.glob("models-backup-*/corrupted.onnx"))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_bytes(), b"old")

    def test_lock_prevents_concurrent_install(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with bootstrap.installation_lock(root) as first:
                self.assertTrue(first)
                with bootstrap.installation_lock(root) as second:
                    self.assertFalse(second)
            with bootstrap.installation_lock(root) as third:
                self.assertTrue(third)

    def test_lock_loser_does_not_change_state(self):
        @contextlib.contextmanager
        def busy(_root):
            yield False
        with tempfile.TemporaryDirectory() as temporary, patch.object(bootstrap, "installation_lock", busy), patch.object(bootstrap, "probe") as probe:
            root = Path(temporary)
            self.assertFalse(bootstrap.ensure_runtime(root, "revision"))
            self.assertFalse((root / "state.json").exists())
            probe.assert_not_called()

    def test_probe_never_downloads_during_health_check(self):
        with patch.object(bootstrap, "run") as run:
            self.assertTrue(bootstrap.probe("python", Path("models")))
            self.assertIn("download_models=False", run.call_args.args[0][-1])
            self.assertIn("importlib.metadata.version", run.call_args.args[0][-1])


if __name__ == "__main__":
    unittest.main()
