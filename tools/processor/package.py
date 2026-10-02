"""수업 패키지 ZIP 쓰기 (schema/package.schema.json). 앱이 manifest의 SHA-256으로 무결성을 검사한다."""
from __future__ import annotations

import hashlib
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from . import SCHEMA_VERSION, VERSION


def write_package(kind: str, files: dict, out_path: Path) -> dict:
    """files: {파일명: bytes | Path}. 파일명은 영문·숫자·._- 만 허용."""
    entries = []
    blobs = {}
    for name, data in files.items():
        if not all(c.isalnum() or c in "._-" for c in name):
            raise ValueError(f"허용되지 않는 파일명: {name}")
        b = Path(data).read_bytes() if isinstance(data, Path) else data
        blobs[name] = b
        entries.append({"path": name, "bytes": len(b), "sha256": hashlib.sha256(b).hexdigest()})
    manifest = {
        "format": "english-review-package",
        "schemaVersion": SCHEMA_VERSION,
        "kind": kind,
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "generator": {"tool": "langdy-processor", "version": VERSION},
        "files": entries,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".tmp")
    with zipfile.ZipFile(tmp, "w") as z:
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2), compress_type=zipfile.ZIP_DEFLATED)
        for name, b in blobs.items():
            ctype = zipfile.ZIP_STORED if name.startswith("audio.") else zipfile.ZIP_DEFLATED
            z.writestr(name, b, compress_type=ctype)
    tmp.replace(out_path)
    return manifest
