#!/usr/bin/env python3
"""Behavioral tests for the local staging secret-material preparer.

Run with ``python3 -I scripts/test_materialize_staging_participant_secrets.py``.
The fixtures deliberately use disposable values.  The test suite never invokes
the materializer with a value on its command line.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "materialize-staging-participant-secrets.py"
WALLETS = [
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
]
MECKY = "a" * 64
ANON = "sb_publishable_test_value_1234567890"


def legacy_jwt(role: str) -> str:
    def segment(value: dict[str, str]) -> str:
        encoded = json.dumps(value, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(encoded).rstrip(b"=").decode()

    return f"{segment({'alg': 'HS256', 'typ': 'JWT'})}.{segment({'role': role, 'iss': 'supabase'})}.c2lnbmF0dXJl"


def digest(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def mode(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def write_private(path: Path, data: bytes, file_mode: int = 0o600) -> None:
    path.write_bytes(data)
    os.chmod(path, file_mode)


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        name, separator, value = line.partition("=")
        if not separator or not name or name in values:
            raise AssertionError(f"invalid fixture output line in {path.name}")
        values[name] = value
    return values


class MaterializeStagingParticipantSecretsTests(unittest.TestCase):
    def setUp(self) -> None:
        # Resolve macOS' /var -> /private alias before passing paths to the
        # tool: the materializer intentionally rejects symlink path
        # components in its trusted output chain.
        temp_parent = Path(tempfile.gettempdir()).resolve()
        self.temp = tempfile.TemporaryDirectory(
            prefix="staging-materializer-test-", dir=str(temp_parent)
        )
        self.root = Path(self.temp.name)
        self.secret_root = self.root / "private-secret-root"
        self.secret_root.mkdir()
        os.chmod(self.secret_root, 0o700)
        self.wallets = self.root / "wallets.txt"
        self.mecky = self.root / "mecky.pub"
        self.public_config = self.root / "public-config.json"
        write_private(self.wallets, ("\n".join(WALLETS) + "\n").encode())
        write_private(self.mecky, (MECKY + "\n").encode())
        write_private(
            self.public_config,
            json.dumps(
                {
                    "schema": "public-config-fixture-v1",
                    "configuration": {"supabaseAnonKey": ANON},
                }
            ).encode(),
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_tool(
        self,
        output: Path,
        *,
        wallets: Path | None = None,
        mecky: Path | None = None,
        public_config: Path | None = None,
        secret_root: Path | None = None,
        isolated: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        command = [
            sys.executable,
        ]
        if isolated:
            command.append("-I")
        command.extend([
            str(SCRIPT),
            "--wallets-file",
            str(wallets or self.wallets),
            "--mecky-pubkey-file",
            str(mecky or self.mecky),
            "--public-config-file",
            str(public_config or self.public_config),
            "--secret-root",
            str(secret_root or self.secret_root),
            "--output-dir",
            str(output),
        ])
        return subprocess.run(command, capture_output=True, text=True, check=False)

    def test_materializes_bounded_files_and_receipt_without_values(self) -> None:
        output = self.secret_root / "materialized"
        result = self.run_tool(output)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(ANON, result.stdout + result.stderr)
        self.assertNotIn(MECKY, result.stdout + result.stderr)
        for wallet in WALLETS:
            self.assertNotIn(wallet, result.stdout + result.stderr)

        self.assertEqual(mode(output), 0o700)
        config_path = output / "config.env"
        runtime_path = output / "runtime.env"
        dba_path = output / "dba.env"
        invite_path = output / "participant-invite.txt"
        receipt_path = output / "receipt.json"
        for path in (config_path, runtime_path, dba_path, invite_path, receipt_path):
            self.assertTrue(path.is_file(), path)
            self.assertFalse(path.is_symlink(), path)
            self.assertEqual(mode(path), 0o600, path)

        config = parse_env(config_path)
        runtime = parse_env(runtime_path)
        dba = parse_env(dba_path)
        self.assertEqual(
            set(config),
            {
                "allowed-wallets",
                "invite-sha256",
                "mecky-pubkey",
            },
        )
        self.assertEqual(
            set(runtime),
            {
                "session-key",
                "supabase-anon-key",
                "supabase-rpc-secret",
            },
        )
        self.assertEqual(
            set(dba),
            {
                "ROEBEL_STAGING_PARTICIPANT_ENVIRONMENT_ARM",
                "VAULT_ROEBEL_STAGING_PARTICIPANT_RPC_SECRET",
            },
        )
        self.assertEqual(config["allowed-wallets"], ",".join(WALLETS))
        self.assertEqual(config["mecky-pubkey"], MECKY)
        self.assertEqual(runtime["supabase-anon-key"], ANON)
        self.assertEqual(dba["ROEBEL_STAGING_PARTICIPANT_ENVIRONMENT_ARM"], "staging-only")

        invite = invite_path.read_text(encoding="utf-8").removesuffix("\n")
        self.assertGreaterEqual(len(invite), 32)
        self.assertLessEqual(len(invite), 128)
        self.assertNotIn("\n", invite)
        self.assertEqual(
            config["invite-sha256"],
            hashlib.sha256(invite.encode()).hexdigest(),
        )
        session = runtime["session-key"]
        rpc = runtime["supabase-rpc-secret"]
        self.assertEqual(rpc, dba["VAULT_ROEBEL_STAGING_PARTICIPANT_RPC_SECRET"])
        self.assertGreaterEqual(len(session), 32)
        self.assertGreaterEqual(len(rpc), 32)
        self.assertEqual(len({invite, session, rpc}), 3)

        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        self.assertEqual(receipt["schema"], "roebel_staging_participant_secret_material_v1")
        self.assertRegex(receipt["timestamp"], r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}T")
        self.assertEqual(receipt["outputDir"], str(output.absolute()))
        outputs = receipt["outputs"]
        self.assertEqual(
            set(outputs), {"config", "runtime", "dba", "invite", "receipt"}
        )
        self.assertEqual(outputs["config"]["keyCount"], 3)
        self.assertEqual(outputs["runtime"]["keyCount"], 3)
        self.assertEqual(outputs["dba"]["keyCount"], 2)
        self.assertEqual(outputs["invite"]["keyCount"], 0)
        self.assertEqual(outputs["receipt"]["keyCount"], 0)
        self.assertEqual(outputs["config"]["path"], str(config_path.absolute()))
        self.assertEqual(outputs["runtime"]["path"], str(runtime_path.absolute()))
        self.assertEqual(outputs["dba"]["path"], str(dba_path.absolute()))
        self.assertEqual(outputs["invite"]["path"], str(invite_path.absolute()))
        self.assertEqual(outputs["receipt"]["path"], str(receipt_path.absolute()))
        self.assertEqual(outputs["config"]["sha256"], digest(config_path.read_bytes()))
        self.assertEqual(outputs["runtime"]["sha256"], digest(runtime_path.read_bytes()))
        self.assertEqual(outputs["dba"]["sha256"], digest(dba_path.read_bytes()))
        self.assertEqual(outputs["invite"]["sha256"], digest(invite_path.read_bytes()))
        self.assertEqual(receipt["bindings"]["rpcCapabilitySha256"], digest(rpc.encode()))

        receipt_text = receipt_path.read_text(encoding="utf-8")
        for value in (ANON, MECKY, *WALLETS, invite, session, rpc):
            self.assertNotIn(value, receipt_text)
        self.assertNotIn("SERVICE_ROLE", receipt_text)
        self.assertNotIn("PRIVATE_KEY", receipt_text)
        self.assertNotIn("BEGIN ", receipt_text)

        tracked = subprocess.run(
            ["git", "-C", str(ROOT), "ls-files", "--error-unmatch", str(output)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(tracked.returncode, 0)

    def test_receipt_input_digests_and_key_name_sets_are_value_free(self) -> None:
        output = self.secret_root / "materialized"
        result = self.run_tool(output)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads((output / "receipt.json").read_text(encoding="utf-8"))
        self.assertEqual(receipt["inputs"]["wallets"]["path"], str(self.wallets.absolute()))
        self.assertEqual(receipt["inputs"]["wallets"]["count"], 2)
        self.assertEqual(receipt["inputs"]["wallets"]["sha256"], digest(self.wallets.read_bytes()))
        self.assertEqual(receipt["inputs"]["meckyPubkey"]["count"], 1)
        self.assertEqual(receipt["inputs"]["meckyPubkey"]["sha256"], digest(self.mecky.read_bytes()))
        self.assertEqual(receipt["inputs"]["publicConfig"]["count"], 1)
        self.assertEqual(
            receipt["inputs"]["publicConfig"]["sha256"], digest(self.public_config.read_bytes())
        )
        self.assertEqual(receipt["outputs"]["config"]["keyNames"], [
            "allowed-wallets",
            "invite-sha256",
            "mecky-pubkey",
        ])
        self.assertEqual(receipt["outputs"]["runtime"]["keyNames"], [
            "session-key",
            "supabase-anon-key",
            "supabase-rpc-secret",
        ])

    def test_simulated_kubectl_from_env_file_keysets_are_exact(self) -> None:
        output = self.secret_root / "materialized"
        result = self.run_tool(output)
        self.assertEqual(result.returncode, 0, result.stderr)

        def simulated_from_env_file(path: Path) -> set[str]:
            return {
                line.partition("=")[0]
                for line in path.read_text(encoding="utf-8").splitlines()
                if line
            }

        self.assertEqual(simulated_from_env_file(output / "config.env"), {
            "allowed-wallets",
            "invite-sha256",
            "mecky-pubkey",
        })
        self.assertEqual(simulated_from_env_file(output / "runtime.env"), {
            "session-key",
            "supabase-anon-key",
            "supabase-rpc-secret",
        })

    def test_rerun_refuses_existing_output_without_overwriting(self) -> None:
        output = self.secret_root / "materialized"
        first = self.run_tool(output)
        self.assertEqual(first.returncode, 0, first.stderr)
        before = {path.name: path.read_bytes() for path in output.iterdir()}
        second = self.run_tool(output)
        self.assertNotEqual(second.returncode, 0)
        self.assertEqual(second.stdout, "")
        self.assertEqual(before, {path.name: path.read_bytes() for path in output.iterdir()})

    def test_rejects_invalid_wallet_content_and_does_not_create_output(self) -> None:
        cases = {
            "uppercase": "0x111111111111111111111111111111111111111A\n",
            "duplicate": (WALLETS[0] + "\n") * 2,
            "too-many": "\n".join(["0x" + format(index, "040x") for index in range(9)]) + "\n",
            "blank": WALLETS[0] + "\n\n",
        }
        for name, content in cases.items():
            with self.subTest(name=name):
                wallets = self.root / f"wallets-{name}.txt"
                write_private(wallets, content.encode())
                output = self.secret_root / f"out-{name}"
                result = self.run_tool(output, wallets=wallets)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(output.exists())

    def test_rejects_invalid_identity_config_and_input_permissions(self) -> None:
        cases: list[tuple[str, Path]] = []
        bad_mecky = self.root / "bad-mecky.pub"
        write_private(bad_mecky, ("A" * 64 + "\n").encode())
        cases.append(("bad-mecky", bad_mecky))
        bad_config = self.root / "bad-config.json"
        write_private(bad_config, b'{"configuration": {"supabaseAnonKey": "sb_secret_not_public"}}')
        cases.append(("bad-config", bad_config))
        for name, path in cases:
            with self.subTest(name=name):
                output = self.secret_root / f"out-{name}"
                result = self.run_tool(output, mecky=path if name == "bad-mecky" else self.mecky,
                                       public_config=path if name == "bad-config" else self.public_config)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(output.exists())

        wrong_mode = self.root / "wrong-mode.txt"
        write_private(wrong_mode, self.wallets.read_bytes(), 0o640)
        output = self.secret_root / "out-wrong-mode"
        result = self.run_tool(output, wallets=wrong_mode)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(output.exists())

    def test_accepts_legacy_anon_jwt_and_rejects_unknown_or_service_keys(self) -> None:
        legacy_config = self.root / "legacy-config.json"
        legacy_anon = legacy_jwt("anon")
        write_private(legacy_config, json.dumps({"supabaseAnonKey": legacy_anon}).encode())
        legacy_output = self.secret_root / "out-legacy"
        result = self.run_tool(legacy_output, public_config=legacy_config)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(parse_env(legacy_output / "runtime.env")["supabase-anon-key"], legacy_anon)

        rejected = {
            "service-role-jwt": legacy_jwt("service_role"),
            "secret-prefix": "sb_secret_test_value_1234567890",
            "unknown-opaque": "opaque_anon_value_1234567890",
        }
        for name, value in rejected.items():
            with self.subTest(name=name):
                config = self.root / f"{name}.json"
                write_private(config, json.dumps({"supabaseAnonKey": value}).encode())
                output = self.secret_root / f"out-{name}"
                result = self.run_tool(output, public_config=config)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(output.exists())

    def test_non_isolated_invocation_fails_before_creating_output(self) -> None:
        output = self.secret_root / "out-non-isolated"
        result = self.run_tool(output, isolated=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertIn("isolated_safe_path_required", result.stderr)
        self.assertFalse(output.exists())

    def test_rejects_symlink_input_and_preexisting_output(self) -> None:
        symlink = self.root / "wallets-link.txt"
        symlink.symlink_to(self.wallets)
        output = self.secret_root / "out-symlink"
        result = self.run_tool(output, wallets=symlink)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(output.exists())

        existing = self.secret_root / "already-exists"
        existing.mkdir()
        result = self.run_tool(existing)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(existing.iterdir()), [])

    def test_accepts_external_owner_only_secret_root(self) -> None:
        output = self.secret_root / "external-success"
        self.assertFalse(str(output).startswith(str(ROOT) + os.sep))
        result = self.run_tool(output)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(mode(self.secret_root), 0o700)
        self.assertEqual(mode(output), 0o700)
        self.assertFalse((output / ".git").exists())

    def test_rejects_output_inside_git_worktree(self) -> None:
        worktree = self.root / "fake-worktree"
        worktree.mkdir()
        os.chmod(worktree, 0o700)
        (worktree / ".git").mkdir()
        os.chmod(worktree / ".git", 0o700)
        secret_root = worktree / "private-secret-root"
        secret_root.mkdir()
        os.chmod(secret_root, 0o700)
        output = secret_root / "materialized"

        result = self.run_tool(output, secret_root=secret_root)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("output_path_inside_git_worktree", result.stderr)
        self.assertFalse(output.exists())

    def test_rejects_shared_or_group_writable_secret_root_parent(self) -> None:
        for parent_mode in (0o777, 0o775, 0o770):
            with self.subTest(parent_mode=oct(parent_mode)):
                shared_parent = self.root / f"shared-{parent_mode:o}"
                shared_parent.mkdir()
                os.chmod(shared_parent, parent_mode)
                secret_root = shared_parent / "private-secret-root"
                secret_root.mkdir()
                os.chmod(secret_root, 0o700)
                output = secret_root / "materialized"

                result = self.run_tool(output, secret_root=secret_root)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("secret_root_parent_must_be_private", result.stderr)
                self.assertFalse(output.exists())

    def test_symlink_and_rename_replacement_fail_closed(self) -> None:
        real_root = self.root / "real-secret-root"
        real_root.mkdir()
        os.chmod(real_root, 0o700)
        symlink_root = self.root / "symlink-secret-root"
        symlink_root.symlink_to(real_root, target_is_directory=True)
        result = self.run_tool(
            symlink_root / "materialized", secret_root=symlink_root
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret_root_path_component_invalid", result.stderr)
        self.assertFalse((symlink_root / "materialized").exists())

        rename_parent = self.root / "rename-parent"
        rename_parent.mkdir()
        os.chmod(rename_parent, 0o700)
        original_path = rename_parent / "private-secret-root"
        original_path.mkdir()
        os.chmod(original_path, 0o700)
        moved_parent = self.root / "moved-parent"
        os.rename(rename_parent, moved_parent)
        rename_parent.symlink_to(moved_parent, target_is_directory=True)
        stale_root = rename_parent / "private-secret-root"
        result = self.run_tool(stale_root / "materialized", secret_root=stale_root)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret_root_path_component_invalid", result.stderr)
        self.assertFalse((stale_root / "materialized").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
