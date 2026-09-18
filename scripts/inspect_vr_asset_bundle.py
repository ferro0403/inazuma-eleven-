#!/usr/bin/env python3
"""Inventory Victory Road asset bundles without guessing asset identity.

The tool accepts a ZIP archive, a directory, or one file. It reports:
- archive/file SHA-256 and byte sizes;
- each member/path, extension, magic-derived format and hashes;
- Level-5 magic offsets embedded inside packed files;
- embedded ASCII references to relevant G4 asset/config filenames;
- deterministic matches against an optional asset-requirements manifest.

No file is assigned to a character or body from its name, dimensions, gender,
or any other heuristic. A requirement only matches an explicitly declared path
suffix from the manifest.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REQUIREMENTS = ROOT / "data/mark_raimon_asset_requirements.json"

KNOWN_EXTENSIONS = {
    ".g4md", ".g4mg", ".g4tx", ".g4sk", ".g4pk", ".g4pkm",
    ".glb", ".cfg", ".bin", ".json", ".xml", ".ndjson", ".dds", ".nxtch",
}
MAGICS = (
    (b"glTF", "glb"),
    (b"G4MD", "g4md"),
    (b"G4TX", "g4tx"),
    (b"G4SK", "g4sk"),
    (b"G4PK", "g4pk"),
    (b"DDS ", "dds"),
)
EMBEDDED_MAGIC_LABELS = {
    b"G4MD": "G4MD",
    b"G4TX": "G4TX",
    b"G4SK": "G4SK",
    b"G4PK": "G4PK",
    b"DDS ": "DDS",
    b"glTF": "GLB",
}
REFERENCE_RE = re.compile(
    rb"(?i)(?:[A-Za-z0-9_.-]+[\\/])*[A-Za-z0-9_.-]+\.(?:g4md|g4mg|g4tx|g4sk|g4pkm|g4pk|cfg\.bin|glb)"
)
MAX_MEMBER_BYTES = 512 * 1024 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalized_path(value: str) -> str:
    value = value.replace("\\", "/")
    while value.startswith("./"):
        value = value[2:]
    return str(PurePosixPath(value)).lstrip("/").casefold()


def compound_extension(name: str) -> str:
    lower = name.casefold()
    if lower.endswith(".cfg.bin"):
        return ".cfg.bin"
    return Path(lower).suffix


def detect_format(name: str, data: bytes) -> tuple[str, str]:
    """Return (format, evidence). Magic wins; G4MG is extension-only by design."""
    head = data[:4]
    for magic, label in MAGICS:
        if head == magic:
            if label == "g4pk" and name.casefold().endswith(".g4pkm"):
                return "g4pkm", "magic:G4PK+extension:.g4pkm"
            return label, f"magic:{magic.decode('ascii', errors='replace')}"
    ext = compound_extension(name)
    if ext == ".g4mg":
        return "g4mg", "extension:.g4mg (format has no magic)"
    if ext == ".g4pkm":
        return "g4pkm", "extension:.g4pkm"
    if ext == ".cfg.bin":
        return "cfg.bin", "extension:.cfg.bin"
    if ext.lstrip(".") in {"json", "xml", "ndjson", "nxtch"}:
        return ext.lstrip("."), f"extension:{ext}"
    if ext:
        return ext.lstrip("."), f"extension:{ext}"
    return "unknown", "no-known-magic-or-extension"


def embedded_magic_offsets(data: bytes) -> list[dict[str, object]]:
    found: list[dict[str, object]] = []
    for magic, label in EMBEDDED_MAGIC_LABELS.items():
        start = 0
        while True:
            at = data.find(magic, start)
            if at < 0:
                break
            found.append({"format": label, "offset": at})
            start = at + 1
    found.sort(key=lambda row: int(row["offset"]))
    return found


def embedded_references(data: bytes, limit: int = 200) -> list[str]:
    refs: list[str] = []
    seen: set[str] = set()
    for match in REFERENCE_RE.finditer(data):
        raw = match.group(0)
        try:
            value = raw.decode("ascii").replace("\\", "/")
        except UnicodeDecodeError:
            continue
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        refs.append(value)
        if len(refs) >= limit:
            break
    return refs


def inspect_bytes(name: str, data: bytes, *, compressed_bytes: int | None = None) -> dict[str, object]:
    fmt, evidence = detect_format(name, data)
    return {
        "path": name.replace("\\", "/"),
        "sizeBytes": len(data),
        "compressedBytes": compressed_bytes,
        "sha256": sha256_bytes(data),
        "extension": compound_extension(name),
        "format": fmt,
        "formatEvidence": evidence,
        "headHex": data[:16].hex(),
        "embeddedMagicOffsets": embedded_magic_offsets(data),
        "embeddedReferences": embedded_references(data),
    }


def iter_directory(path: Path) -> Iterable[tuple[str, bytes, int | None]]:
    for file in sorted(p for p in path.rglob("*") if p.is_file()):
        size = file.stat().st_size
        if size > MAX_MEMBER_BYTES:
            raise RuntimeError(f"member too large ({size} bytes): {file}")
        yield file.relative_to(path).as_posix(), file.read_bytes(), None


def inspect_zip(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    total = 0
    with zipfile.ZipFile(path) as zf:
        for info in sorted(zf.infolist(), key=lambda i: i.filename.casefold()):
            if info.is_dir():
                continue
            if info.file_size > MAX_MEMBER_BYTES:
                raise RuntimeError(
                    f"ZIP member too large ({info.file_size} bytes): {info.filename}"
                )
            total += info.file_size
            if total > MAX_TOTAL_BYTES:
                raise RuntimeError(f"ZIP uncompressed payload exceeds {MAX_TOTAL_BYTES} bytes")
            data = zf.read(info)
            rows.append(inspect_bytes(info.filename, data, compressed_bytes=info.compress_size))
    return rows


def load_requirements(path: Path | None) -> dict[str, object] | None:
    if path is None:
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("requirements"), list):
        raise RuntimeError(f"invalid requirements manifest: {path}")
    return payload


def match_requirements(
    files: list[dict[str, object]],
    manifest: dict[str, object] | None,
) -> dict[str, object] | None:
    if manifest is None:
        return None

    file_paths = [(normalized_path(str(row["path"])), row) for row in files]
    matches: list[dict[str, object]] = []
    for requirement in manifest["requirements"]:
        if not isinstance(requirement, dict):
            continue
        role = str(requirement.get("role") or "")
        accepted = [
            normalized_path(str(value))
            for value in requirement.get("acceptedPathSuffixes", [])
            if str(value).strip()
        ]
        found: list[dict[str, object]] = []
        for actual, row in file_paths:
            for suffix in accepted:
                if actual == suffix or actual.endswith("/" + suffix):
                    found.append({
                        "path": row["path"],
                        "sha256": row["sha256"],
                        "format": row["format"],
                        "matchedSuffix": suffix,
                    })
                    break
        matches.append({
            "role": role,
            "required": bool(requirement.get("required", False)),
            "acceptedPathSuffixes": accepted,
            "found": found,
        })

    missing_required = [
        row["role"] for row in matches if row["required"] and not row["found"]
    ]
    return {
        "manifestId": manifest.get("id"),
        "matches": matches,
        "missingRequired": missing_required,
        "allRequiredPresent": not missing_required,
    }


def inspect_bundle(path: Path, manifest: dict[str, object] | None = None) -> dict[str, object]:
    if not path.exists():
        raise FileNotFoundError(path)

    archive: dict[str, object]
    if path.is_dir():
        files = [inspect_bytes(name, data, compressed_bytes=compressed) for name, data, compressed in iter_directory(path)]
        archive = {
            "kind": "directory",
            "path": str(path),
            "sizeBytes": sum(int(row["sizeBytes"]) for row in files),
            "sha256": None,
        }
    elif zipfile.is_zipfile(path):
        data = path.read_bytes()
        files = inspect_zip(path)
        archive = {
            "kind": "zip",
            "path": str(path),
            "sizeBytes": len(data),
            "sha256": sha256_bytes(data),
        }
    else:
        data = path.read_bytes()
        if len(data) > MAX_MEMBER_BYTES:
            raise RuntimeError(f"file too large ({len(data)} bytes): {path}")
        files = [inspect_bytes(path.name, data)]
        archive = {
            "kind": "file",
            "path": str(path),
            "sizeBytes": len(data),
            "sha256": sha256_bytes(data),
        }

    format_counts = Counter(str(row["format"]) for row in files)
    extension_counts = Counter(str(row["extension"]) for row in files)
    interesting = [
        row for row in files
        if str(row["extension"]).casefold() in KNOWN_EXTENSIONS
        or str(row["format"]) in {"glb", "g4md", "g4mg", "g4tx", "g4sk", "g4pk", "g4pkm", "cfg.bin"}
    ]
    return {
        "version": 1,
        "archive": archive,
        "counts": {
            "files": len(files),
            "formats": dict(sorted(format_counts.items())),
            "extensions": dict(sorted(extension_counts.items())),
        },
        "files": files,
        "interestingFiles": [row["path"] for row in interesting],
        "requirementCheck": match_requirements(files, manifest),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path, help="ZIP archive, directory, or individual asset")
    parser.add_argument(
        "--requirements",
        type=Path,
        default=DEFAULT_REQUIREMENTS if DEFAULT_REQUIREMENTS.exists() else None,
        help="exact path-suffix requirements manifest",
    )
    parser.add_argument("--out", type=Path, help="write JSON report here")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest = load_requirements(args.requirements)
    report = inspect_bundle(args.bundle, manifest)
    encoded = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(encoded, encoding="utf-8")
    else:
        sys.stdout.write(encoded)

    check = report.get("requirementCheck")
    if isinstance(check, dict) and not check.get("allRequiredPresent", False):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
