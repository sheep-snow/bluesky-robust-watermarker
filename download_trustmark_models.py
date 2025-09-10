#!/usr/bin/env python3
"""
Download TrustMark models during Docker build to avoid runtime download issues.
"""

import os
import shutil
from pathlib import Path

# Set temporary download directory
temp_dir = "/tmp/trustmark_temp"
os.makedirs(temp_dir, exist_ok=True)
os.environ["HOME"] = temp_dir
os.environ["TRUSTMARK_CACHE_DIR"] = temp_dir

try:
    print("Initializing TrustMark to download models...")
    from trustmark import TrustMark

    tm = TrustMark(verbose=False)
    print("TrustMark models downloaded successfully")

    # Find and copy downloaded models to persistent location
    trustmark_pkg = Path("/usr/local/lib/python3.12/site-packages/trustmark")
    if (trustmark_pkg / "models").exists():
        shutil.copytree(
            trustmark_pkg / "models", "/tmp/trustmark_models", dirs_exist_ok=True
        )
        print("Models copied to /tmp/trustmark_models")

    # Also check temp directory for downloaded models
    for item in Path(temp_dir).glob("**/*"):
        if item.is_file() and item.suffix in [".yaml", ".pth", ".pt"]:
            dest = Path("/tmp/trustmark_models") / item.name
            shutil.copy2(item, dest)
            print(f"Copied model file: {item.name}")

except Exception as e:
    print(f"TrustMark pre-download failed (this may be expected): {e}")
    # Create empty models directory even if download fails
    os.makedirs("/tmp/trustmark_models", exist_ok=True)

print("TrustMark model download script completed")
