#!/usr/bin/env python3
"""Materialize bounded staging participant inputs into owner-only files.

This is deliberately a local preparation step.  It does not contact Supabase,
Kubernetes, GitHub, or any other service, and it never accepts a secret value on
the command line.  The resulting files are intended to be handed to the
separate, reviewed database and Kubernetes activation steps.

Invoke with ``python3 -I``.  All three input files must already be regular,
owner-readable-only (0600) files owned by the invoking user.  Output is only
allowed as a new direct child of an existing, external private secret root
(``--secret-root``).  The root must be owner-only (0700), its enclosing
directories must be owned by the invoking user or root and not writable by
group/other, and no path component may be a symlink or an enclosing Git
worktree.  Refusing to overwrite an existing directory is part of the
secret-handling contract.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import os
import re
import secrets
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


FILE_MODE = 0o600
DIRECTORY_MODE = 0o700
MAX_INPUT_BYTES = 1024 * 1024
WALLET_PATTERN = re.compile(r"0x[0-9a-f]{40}\Z")
MECKY_PATTERN = re.compile(r"[0-9a-f]{64}\Z")
MODERN_SUPABASE_ANON_PATTERN = re.compile(r"sb_publishable_[A-Za-z0-9_-]{16,256}\Z")
JWT_SEGMENT_PATTERN = re.compile(r"[A-Za-z0-9_-]+\Z")

CONFIG_ENV_KEYS = (
    "allowed-wallets",
    "invite-sha256",
    "mecky-pubkey",
)
RUNTIME_ENV_KEYS = (
    "session-key",
    "supabase-anon-key",
    "supabase-rpc-secret",
)
DBA_ENV_KEYS = (
    "ROEBEL_STAGING_PARTICIPANT_ENVIRONMENT_ARM",
    "VAULT_ROEBEL_STAGING_PARTICIPANT_RPC_SECRET",
)
OUTPUT_NAMES = ("config.env", "runtime.env", "dba.env", "participant-invite.txt", "receipt.json")
OUTPUT_DIRECTORY_NAME_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")


class MaterializationError(Exception):
    """A safe, value-free operator error."""


def _error(code: str) -> MaterializationError:
    # Codes are constants from this module; never interpolate file contents or
    # parsed values into an error that might be copied into a log.
    return MaterializationError(code)


def _absolute(path_value: str) -> Path:
    """Return an absolute lexical path without following symlinks."""

    try:
        path = Path(path_value).expanduser()
    except (TypeError, ValueError, OSError) as exc:
        raise _error("path_invalid") from exc
    if not path.is_absolute():
        path = Path.cwd() / path
    # os.path.abspath normalizes ``.`` and ``..`` lexically.  It does not
    # resolve a symlink in an existing path component.
    return Path(os.path.abspath(os.fspath(path)))


def _regular_owned_mode(st: os.stat_result, *, directory: bool) -> bool:
    expected_type = stat.S_IFDIR if directory else stat.S_IFREG
    return (
        stat.S_IFMT(st.st_mode) == expected_type
        and st.st_uid == os.geteuid()
        and stat.S_IMODE(st.st_mode) == (DIRECTORY_MODE if directory else FILE_MODE)
    )


def _safe_enclosing_directory(st: os.stat_result) -> bool:
    """Allow only stable, non-shared parents around the private root.

    The secret root and generated output directory are stricter 0700
    directories.  Ancestors may be ordinary system/user directories when
    they are owned by root or this process and cannot be renamed by group or
    other users.  Group/world read or execute access is therefore harmless to
    the values, while any group/world write access is rejected because it can
    make a path component stale or replaceable.
    """

    return (
        stat.S_ISDIR(st.st_mode)
        and st.st_uid in (os.geteuid(), 0)
        and not (stat.S_IMODE(st.st_mode) & 0o022)
    )


def _directory_flags() -> int:
    return os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)


def _directory_identity(st: os.stat_result) -> tuple[int, int]:
    return st.st_dev, st.st_ino


def _reject_git_marker(directory_fd: int) -> None:
    """Reject a path below any worktree/source repository marker."""

    try:
        os.stat(".git", dir_fd=directory_fd, follow_symlinks=False)
    except FileNotFoundError:
        return
    except OSError as exc:
        raise _error("git_marker_check_failed") from exc
    raise _error("output_path_inside_git_worktree")


def _verify_path_identity(path: Path, expected: tuple[int, int]) -> None:
    try:
        current = os.lstat(os.fspath(path))
    except OSError as exc:
        raise _error("trusted_root_path_changed") from exc
    if _directory_identity(current) != expected or not _regular_owned_mode(current, directory=True):
        raise _error("trusted_root_path_changed")


def _open_trusted_secret_root(path: Path) -> tuple[int, tuple[int, int]]:
    """Open and verify an external 0700 secret root through stable dirfds."""

    if not path.is_absolute() or path == Path(path.anchor):
        raise _error("secret_root_path_invalid")

    chain: list[int] = []
    try:
        try:
            root_fd = os.open(os.path.sep, _directory_flags())
        except OSError as exc:
            raise _error("secret_root_open_failed") from exc
        chain.append(root_fd)

        for component in path.parts[1:]:
            if component in ("", ".", "..", ".git"):
                raise _error("secret_root_path_invalid")
            parent_fd = chain[-1]
            _reject_git_marker(parent_fd)
            try:
                before = os.stat(component, dir_fd=parent_fd, follow_symlinks=False)
            except OSError as exc:
                raise _error("secret_root_path_unreadable") from exc
            if stat.S_ISLNK(before.st_mode) or not stat.S_ISDIR(before.st_mode):
                raise _error("secret_root_path_component_invalid")
            if not _safe_enclosing_directory(before):
                raise _error("secret_root_parent_must_be_private")
            try:
                child_fd = os.open(component, _directory_flags(), dir_fd=parent_fd)
            except OSError as exc:
                raise _error("secret_root_path_open_failed") from exc
            chain.append(child_fd)
            try:
                after = os.fstat(child_fd)
                if _directory_identity(before) != _directory_identity(after):
                    raise _error("secret_root_path_changed")
                if stat.S_ISLNK(after.st_mode) or not _safe_enclosing_directory(after):
                    raise _error("secret_root_parent_must_be_private")
            except MaterializationError:
                raise
            except OSError as exc:
                raise _error("secret_root_path_verify_failed") from exc

        _reject_git_marker(chain[-1])
        root_stat = os.fstat(chain[-1])
        if not _regular_owned_mode(root_stat, directory=True):
            raise _error("secret_root_must_be_owned_0700")
        identity = _directory_identity(root_stat)
        _verify_path_identity(path, identity)

        # Keep the final root descriptor; every lookup below it is relative to
        # that descriptor, so a shared-parent rename cannot redirect writes.
        final_fd = chain[-1]
        chain.pop()
        for fd in chain:
            os.close(fd)
        return final_fd, identity
    except BaseException:
        for fd in reversed(chain):
            try:
                os.close(fd)
            except OSError:
                pass
        raise


def _input_bytes(path_value: str, label: str) -> tuple[Path, bytes]:
    """Read an input with ownership/mode/race checks and a hard size bound."""

    path = _absolute(path_value)
    try:
        before = os.lstat(os.fspath(path))
    except OSError as exc:
        raise _error(f"{label}_input_unreadable") from exc
    if stat.S_ISLNK(before.st_mode):
        raise _error(f"{label}_input_symlink")
    if not _regular_owned_mode(before, directory=False):
        raise _error(f"{label}_input_must_be_owned_0600_regular_file")
    if before.st_size > MAX_INPUT_BYTES:
        raise _error(f"{label}_input_too_large")

    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(os.fspath(path), flags)
    except OSError as exc:
        raise _error(f"{label}_input_open_failed") from exc

    try:
        after = os.fstat(fd)
        if (
            (after.st_dev, after.st_ino) != (before.st_dev, before.st_ino)
            or not _regular_owned_mode(after, directory=False)
        ):
            raise _error(f"{label}_input_changed")
        data = bytearray()
        while True:
            try:
                chunk = os.read(fd, 131072)
            except OSError as exc:
                raise _error(f"{label}_input_read_failed") from exc
            if not chunk:
                break
            data.extend(chunk)
            if len(data) > MAX_INPUT_BYTES:
                raise _error(f"{label}_input_too_large")
        final = os.fstat(fd)
        if (
            (final.st_dev, final.st_ino) != (before.st_dev, before.st_ino)
            or not _regular_owned_mode(final, directory=False)
        ):
            raise _error(f"{label}_input_changed")
        return path, bytes(data)
    finally:
        try:
            os.close(fd)
        except OSError as exc:
            raise _error(f"{label}_input_close_failed") from exc


def _ascii_text(data: bytes, label: str) -> str:
    try:
        return data.decode("ascii")
    except UnicodeDecodeError as exc:
        raise _error(f"{label}_input_must_be_ascii") from exc


def _one_optional_final_newline(text: str, label: str) -> str:
    if text.endswith("\n"):
        text = text[:-1]
    if "\n" in text or "\r" in text:
        raise _error(f"{label}_input_line_shape_invalid")
    return text


def _parse_wallets(data: bytes) -> tuple[str, ...]:
    text = _ascii_text(data, "wallets")
    if text.endswith("\n"):
        text = text[:-1]
    if "\r" in text or not text:
        raise _error("wallets_input_line_shape_invalid")
    lines = text.split("\n")
    if not 1 <= len(lines) <= 8:
        raise _error("wallets_input_count_invalid")
    wallets: list[str] = []
    for wallet in lines:
        if not WALLET_PATTERN.fullmatch(wallet):
            raise _error("wallets_input_address_invalid")
        if wallet in wallets:
            raise _error("wallets_input_duplicate")
        wallets.append(wallet)
    return tuple(wallets)


def _parse_mecky_pubkey(data: bytes) -> str:
    text = _one_optional_final_newline(_ascii_text(data, "mecky_pubkey"), "mecky_pubkey")
    if not MECKY_PATTERN.fullmatch(text):
        raise _error("mecky_pubkey_input_invalid")
    return text


def _unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name, value in pairs:
        if name in result:
            raise ValueError("duplicate_json_key")
        result[name] = value
    return result


def _parse_public_config(data: bytes) -> str:
    try:
        text = data.decode("utf-8")
        document = json.loads(
            text,
            object_pairs_hook=_unique_json_object,
            parse_constant=lambda _value: (_ for _ in ()).throw(ValueError("json_constant")),
        )
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise _error("public_config_input_json_invalid") from exc
    if not isinstance(document, dict):
        raise _error("public_config_input_root_invalid")

    candidates: list[Any] = []
    if "supabaseAnonKey" in document:
        candidates.append(document["supabaseAnonKey"])
    nested = document.get("configuration")
    if isinstance(nested, dict) and "supabaseAnonKey" in nested:
        candidates.append(nested["supabaseAnonKey"])
    if not candidates or any(not isinstance(value, str) for value in candidates):
        raise _error("public_config_supabase_anon_key_missing")
    if any(value != candidates[0] for value in candidates[1:]):
        raise _error("public_config_supabase_anon_key_conflict")

    anon_key = candidates[0]
    if not 16 <= len(anon_key) <= 4096 or anon_key != anon_key.strip():
        raise _error("public_config_supabase_anon_key_shape_invalid")
    if any(ord(character) < 0x21 or ord(character) > 0x7E for character in anon_key):
        raise _error("public_config_supabase_anon_key_characters_invalid")
    if not _valid_public_anon_key(anon_key):
        raise _error("public_config_supabase_anon_key_not_public")
    return anon_key


def _decode_jwt_segment(segment: str) -> Any:
    if not JWT_SEGMENT_PATTERN.fullmatch(segment):
        raise ValueError("jwt_segment_invalid")
    padding = "=" * ((4 - len(segment) % 4) % 4)
    try:
        decoded = base64.urlsafe_b64decode((segment + padding).encode("ascii"))
        if base64.urlsafe_b64encode(decoded).rstrip(b"=").decode("ascii") != segment:
            raise ValueError("jwt_segment_noncanonical")
    except (ValueError, binascii.Error) as exc:
        raise ValueError("jwt_segment_encoding_invalid") from exc
    return decoded


def _decode_jwt_json_segment(segment: str) -> Any:
    try:
        decoded = _decode_jwt_segment(segment)
        return json.loads(
            decoded.decode("utf-8"),
            object_pairs_hook=_unique_json_object,
            parse_constant=lambda _value: (_ for _ in ()).throw(ValueError("json_constant")),
        )
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError, TypeError) as exc:
        raise ValueError("jwt_segment_json_invalid") from exc


def _valid_legacy_anon_jwt(value: str) -> bool:
    parts = value.split(".")
    if len(parts) != 3 or any(not JWT_SEGMENT_PATTERN.fullmatch(part) for part in parts):
        return False
    try:
        header = _decode_jwt_json_segment(parts[0])
        payload = _decode_jwt_json_segment(parts[1])
        _decode_jwt_segment(parts[2])
    except ValueError:
        return False
    return isinstance(header, dict) and isinstance(payload, dict) and payload.get("role") == "anon"


def _valid_public_anon_key(value: str) -> bool:
    return bool(MODERN_SUPABASE_ANON_PATTERN.fullmatch(value)) or _valid_legacy_anon_jwt(value)


def _sha256(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def _hex_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _env_bytes(values: list[tuple[str, str]]) -> bytes:
    lines: list[str] = []
    for name, value in values:
        if not name or "=" in name or "\n" in name or "\r" in name:
            raise _error("generated_environment_name_invalid")
        if "\n" in value or "\r" in value or "\x00" in value:
            raise _error("generated_environment_value_invalid")
        lines.append(f"{name}={value}")
    return ("\n".join(lines) + "\n").encode("utf-8")


def _remove_empty_output_directory(
    secret_root_fd: int, name: str, expected: tuple[int, int] | None
) -> None:
    """Remove only an empty directory created by this invocation."""

    if expected is None:
        return
    try:
        current = os.stat(name, dir_fd=secret_root_fd, follow_symlinks=False)
        if (
            _directory_identity(current) != expected
            or not _regular_owned_mode(current, directory=True)
        ):
            return
        os.rmdir(name, dir_fd=secret_root_fd)
        os.fsync(secret_root_fd)
    except (OSError, MaterializationError):
        pass


def _create_output_directory(
    secret_root_fd: int,
    secret_root_path: Path,
    secret_root_identity: tuple[int, int],
    name: str,
) -> tuple[int, tuple[int, int]]:
    """Create a new 0700 output child using the stable secret-root dirfd."""

    _verify_path_identity(secret_root_path, secret_root_identity)
    try:
        os.mkdir(name, DIRECTORY_MODE, dir_fd=secret_root_fd)
    except FileExistsError as exc:
        raise _error("output_directory_must_not_exist") from exc
    except OSError as exc:
        raise _error("output_directory_create_failed") from exc

    fd: int | None = None
    identity: tuple[int, int] | None = None
    try:
        directory_stat = os.stat(name, dir_fd=secret_root_fd, follow_symlinks=False)
        if not _regular_owned_mode(directory_stat, directory=True):
            raise _error("output_directory_owner_or_mode_invalid")
        identity = _directory_identity(directory_stat)
        fd = os.open(name, _directory_flags(), dir_fd=secret_root_fd)
        opened_stat = os.fstat(fd)
        if (
            _directory_identity(opened_stat) != identity
            or not _regular_owned_mode(opened_stat, directory=True)
        ):
            raise _error("output_directory_changed")
        _verify_path_identity(secret_root_path, secret_root_identity)
        os.fsync(secret_root_fd)
        return fd, identity
    except MaterializationError:
        if fd is not None:
            os.close(fd)
        _remove_empty_output_directory(secret_root_fd, name, identity)
        raise
    except OSError as exc:
        if fd is not None:
            os.close(fd)
        _remove_empty_output_directory(secret_root_fd, name, identity)
        raise _error("output_directory_open_failed") from exc


def _validate_output_file(st: os.stat_result, expected: tuple[int, int]) -> None:
    if (st.st_dev, st.st_ino) != expected or not _regular_owned_mode(st, directory=False):
        raise _error("output_file_owner_or_mode_invalid")


def _write_output_file(directory_fd: int, name: str, data: bytes) -> tuple[Path, str]:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(name, flags, FILE_MODE, dir_fd=directory_fd)
    except FileExistsError as exc:
        raise _error("output_file_already_exists") from exc
    except OSError as exc:
        raise _error("output_file_create_failed") from exc

    expected: tuple[int, int] | None = None
    try:
        initial_stat = os.fstat(fd)
        expected = (initial_stat.st_dev, initial_stat.st_ino)
        if not stat.S_ISREG(initial_stat.st_mode) or initial_stat.st_uid != os.geteuid():
            raise _error("output_file_owner_or_mode_invalid")
        os.fchmod(fd, FILE_MODE)
        offset = 0
        while offset < len(data):
            try:
                written = os.write(fd, data[offset:])
            except OSError as exc:
                raise _error("output_file_write_failed") from exc
            if written <= 0:
                raise _error("output_file_write_failed")
            offset += written
        try:
            os.fsync(fd)
        except OSError as exc:
            raise _error("output_file_fsync_failed") from exc
        opened_stat = os.fstat(fd)
        expected = (opened_stat.st_dev, opened_stat.st_ino)
        _validate_output_file(opened_stat, expected)
    except MaterializationError:
        _unlink_output_file_if_identity(directory_fd, name, expected)
        raise
    except OSError as exc:
        _unlink_output_file_if_identity(directory_fd, name, expected)
        raise _error("output_file_write_failed") from exc
    finally:
        try:
            os.close(fd)
        except OSError as exc:
            _unlink_output_file_if_identity(directory_fd, name, expected)
            raise _error("output_file_close_failed") from exc

    try:
        path_stat = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        assert expected is not None
        _validate_output_file(path_stat, expected)
    except (OSError, MaterializationError, AssertionError) as exc:
        _unlink_output_file_if_identity(directory_fd, name, expected)
        if isinstance(exc, MaterializationError):
            raise
        raise _error("output_file_recheck_failed") from exc
    return Path(name), _sha256(data)


def _unlink_output_file_if_identity(
    directory_fd: int, name: str, expected: tuple[int, int] | None
) -> None:
    """Remove only a partial file created by this descriptor, never a replacement."""

    if expected is None:
        return
    try:
        current = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    except OSError:
        return
    if (current.st_dev, current.st_ino) != expected:
        return
    try:
        os.unlink(name, dir_fd=directory_fd)
    except (OSError, MaterializationError):
        pass


def _cleanup_new_output(
    secret_root_fd: int,
    output_directory_fd: int | None,
    name: str,
    directory_identity: tuple[int, int] | None,
    names: list[str],
) -> None:
    """Best-effort cleanup limited to the exact directory this run created."""

    if directory_identity is None or output_directory_fd is None:
        return
    for child_name in names:
        try:
            child_stat = os.stat(child_name, dir_fd=output_directory_fd, follow_symlinks=False)
        except OSError:
            continue
        if child_stat.st_uid != os.geteuid() or not stat.S_ISREG(child_stat.st_mode):
            continue
        try:
            os.unlink(child_name, dir_fd=output_directory_fd)
        except OSError:
            continue
    _remove_empty_output_directory(secret_root_fd, name, directory_identity)


def _timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _descriptor(path: Path, key_names: list[str], key_count: int, data: bytes | None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "path": str(path.absolute()),
        "mode": "0600",
        "keyNames": key_names,
        "keyCount": key_count,
    }
    if data is not None:
        result["sha256"] = _sha256(data)
    return result


def materialize(
    *,
    wallets_file: str,
    mecky_pubkey_file: str,
    public_config_file: str,
    secret_root: str,
    output_dir: str,
) -> dict[str, Any]:
    """Validate inputs, write material, and return the value-free receipt."""

    wallets_path, wallets_bytes = _input_bytes(wallets_file, "wallets")
    mecky_path, mecky_bytes = _input_bytes(mecky_pubkey_file, "mecky_pubkey")
    config_path, public_config_bytes = _input_bytes(public_config_file, "public_config")
    wallets = _parse_wallets(wallets_bytes)
    mecky_pubkey = _parse_mecky_pubkey(mecky_bytes)
    supabase_anon_key = _parse_public_config(public_config_bytes)

    secret_root_path = _absolute(secret_root)
    output_path = _absolute(output_dir)
    if output_path.parent != secret_root_path:
        raise _error("output_must_be_direct_child_of_secret_root")
    output_name = output_path.name
    if not OUTPUT_DIRECTORY_NAME_PATTERN.fullmatch(output_name) or output_name == ".git":
        raise _error("output_directory_name_invalid")

    secret_root_fd: int | None = None
    secret_root_identity: tuple[int, int] | None = None
    directory_fd: int | None = None
    directory_identity: tuple[int, int] | None = None
    created_names: list[str] = []
    try:
        secret_root_fd, secret_root_identity = _open_trusted_secret_root(secret_root_path)
        directory_fd, directory_identity = _create_output_directory(
            secret_root_fd,
            secret_root_path,
            secret_root_identity,
            output_name,
        )

        # token_urlsafe uses the system CSPRNG.  The three values are generated
        # by independent calls and never enter the receipt or stdout.
        session_key = secrets.token_urlsafe(48)
        rpc_secret = secrets.token_urlsafe(48)
        invite = secrets.token_urlsafe(32)
        invite_digest = _hex_sha256(invite.encode("utf-8"))

        config_bytes = _env_bytes([
            (CONFIG_ENV_KEYS[0], ",".join(wallets)),
            (CONFIG_ENV_KEYS[1], invite_digest),
            (CONFIG_ENV_KEYS[2], mecky_pubkey),
        ])
        runtime_bytes = _env_bytes([
            (RUNTIME_ENV_KEYS[0], session_key),
            (RUNTIME_ENV_KEYS[1], supabase_anon_key),
            (RUNTIME_ENV_KEYS[2], rpc_secret),
        ])
        dba_bytes = _env_bytes([
            (DBA_ENV_KEYS[0], "staging-only"),
            (DBA_ENV_KEYS[1], rpc_secret),
        ])
        invite_bytes = (invite + "\n").encode("utf-8")

        output_records: dict[str, dict[str, Any]] = {}
        for logical_name, filename, content, key_names, key_count in (
            ("config", "config.env", config_bytes, ["allowed-wallets", "invite-sha256", "mecky-pubkey"], 3),
            ("runtime", "runtime.env", runtime_bytes, ["session-key", "supabase-anon-key", "supabase-rpc-secret"], 3),
            ("dba", "dba.env", dba_bytes, ["environment-arm", "vault-rpc-capability"], 2),
            ("invite", "participant-invite.txt", invite_bytes, [], 0),
        ):
            _write_output_file(directory_fd, filename, content)
            created_names.append(filename)
            output_records[logical_name] = _descriptor(output_path / filename, key_names, key_count, content)

        receipt = {
            "schema": "roebel_staging_participant_secret_material_v1",
            "timestamp": _timestamp(),
            "outputDir": str(output_path.absolute()),
            "inputs": {
                "wallets": {
                    **_descriptor(wallets_path, ["wallet-address"], len(wallets), wallets_bytes),
                    "count": len(wallets),
                },
                "meckyPubkey": {
                    **_descriptor(mecky_path, ["mecky-pubkey"], 1, mecky_bytes),
                    "count": 1,
                },
                "publicConfig": {
                    **_descriptor(config_path, ["public-routing"], 1, public_config_bytes),
                    "count": 1,
                },
            },
            "outputs": {
                **output_records,
                # A receipt cannot contain a self-hash without being
                # self-referential.  Its path and key-set count are still
                # recorded; the four material files carry content hashes.
                "receipt": _descriptor(output_path / "receipt.json", [], 0, None),
            },
            "bindings": {
                "rpcCapabilitySha256": _sha256(rpc_secret.encode("utf-8")),
            },
        }
        receipt_bytes = (json.dumps(receipt, ensure_ascii=True, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
        _write_output_file(directory_fd, "receipt.json", receipt_bytes)
        created_names.append("receipt.json")
        try:
            os.fsync(directory_fd)
        except OSError as exc:
            raise _error("output_directory_fsync_failed") from exc
        _verify_path_identity(secret_root_path, secret_root_identity)
        output_stat = os.stat(output_name, dir_fd=secret_root_fd, follow_symlinks=False)
        if (
            _directory_identity(output_stat) != directory_identity
            or not _regular_owned_mode(output_stat, directory=True)
        ):
            raise _error("output_directory_changed")
        return receipt
    except MaterializationError:
        if secret_root_fd is not None:
            _cleanup_new_output(
                secret_root_fd,
                directory_fd,
                output_name,
                directory_identity,
                created_names,
            )
        raise
    except (OSError, AssertionError) as exc:
        if secret_root_fd is not None:
            _cleanup_new_output(
                secret_root_fd,
                directory_fd,
                output_name,
                directory_identity,
                created_names,
            )
        raise _error("materialization_failed") from exc
    finally:
        if directory_fd is not None:
            os.close(directory_fd)
        if secret_root_fd is not None:
            os.close(secret_root_fd)


def _arguments(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create local owner-only staging participant material; no activation is performed."
    )
    parser.add_argument("--wallets-file", required=True, help="0600 file containing 1-8 lowercase wallet addresses")
    parser.add_argument("--mecky-pubkey-file", required=True, help="0600 file containing one lowercase 64-hex public key")
    parser.add_argument("--public-config-file", required=True, help="0600 public staging JSON containing supabaseAnonKey")
    parser.add_argument(
        "--secret-root",
        required=True,
        help="existing external owner-only 0700 secret root; output must be its new direct child",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="new direct child of --secret-root; it must not already exist",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _arguments(sys.argv[1:] if argv is None else argv)
    try:
        receipt = materialize(
            wallets_file=args.wallets_file,
            mecky_pubkey_file=args.mecky_pubkey_file,
            public_config_file=args.public_config_file,
            secret_root=args.secret_root,
            output_dir=args.output_dir,
        )
    except MaterializationError as exc:
        # The exception message contains only a fixed error code.  No parsed
        # value, environment line, or credential is ever sent to stdout.
        print(f"materialization failed: {exc}", file=sys.stderr)
        return 2
    print(f"materialized: {receipt['outputs']['receipt']['path']}")
    return 0


if __name__ == "__main__":
    if sys.flags.isolated != 1 or getattr(sys.flags, "safe_path", 0) != 1:
        print("materialization failed: isolated_safe_path_required", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main())
