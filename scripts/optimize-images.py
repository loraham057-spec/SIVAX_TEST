"""Recompresses the PNG assets in public/ without visible loss.

`public/logo_diav1.png` weighed 652 Ko for a logo displayed at a few hundred
pixels — and it is fetched from every transactional e-mail, so it is paid for on
every message, not just on page load. The PWA icons were similarly oversized for
their declared dimensions.

The transform is lossless-by-perception: RGBA is preserved, images are only
downscaled when they exceed the size they are actually rendered at, then
quantised to a 256-colour palette when that is visually equivalent (flat-colour
logos and icons are), and finally re-encoded with maximum zlib effort.

    python scripts/optimize-images.py            # report only
    python scripts/optimize-images.py --write    # rewrite the files
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Windows consoles still default to cp1252, which cannot encode the arrows below.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"

# filename → maximum rendered dimension. None keeps the current size.
TARGETS: dict[str, int | None] = {
    "logo_diav1.png": 512,
    "icon-512.png": 512,
    "icon-192.png": 192,
    "apple-touch-icon.png": 180,
    "favicon-32.png": 32,
    "favicon-16.png": 16,
}

# Static-asset budget from the performance budgets table.
MAX_ASSET_BYTES = 500 * 1024


def optimize(path: Path, max_dimension: int | None, write: bool) -> tuple[int, int]:
    before = path.stat().st_size
    with Image.open(path) as img:
        img = img.convert("RGBA")

        if max_dimension and max(img.size) > max_dimension:
            img.thumbnail((max_dimension, max_dimension), Image.LANCZOS)

        # Palettise only when the image already fits in 256 colours, so the
        # result is pixel-identical. Anything richer keeps full RGBA and gains
        # only from the resize and the stronger deflate.
        # FASTOCTREE is the only quantiser that accepts an alpha channel.
        fits_palette = img.getcolors(maxcolors=256) is not None
        candidate = img.quantize(colors=256, method=Image.FASTOCTREE) if fits_palette else img

        out = path.with_suffix(".opt.png")
        candidate.save(out, format="PNG", optimize=True, compress_level=9)
        after = out.stat().st_size

        if after >= before:
            out.unlink()
            return before, before

        if write:
            out.replace(path)
        else:
            out.unlink()

    return before, after


def main() -> int:
    parser = argparse.ArgumentParser(description="Recompress public/ PNG assets.")
    parser.add_argument("--write", action="store_true", help="rewrite the files in place")
    args = parser.parse_args()

    total_before = total_after = 0
    over_budget: list[str] = []

    for name, max_dimension in TARGETS.items():
        path = PUBLIC / name
        if not path.exists():
            continue
        before, after = optimize(path, max_dimension, args.write)
        total_before += before
        total_after += after
        change = "inchangé" if before == after else f"-{100 - after / before * 100:.1f} %"
        print(f"{name:24} {before / 1024:8.1f} Ko → {after / 1024:7.1f} Ko  {change}")
        if after > MAX_ASSET_BYTES:
            over_budget.append(name)

    if total_before:
        print(
            f"\nTotal : {total_before / 1024:.0f} Ko → {total_after / 1024:.0f} Ko "
            f"(-{100 - total_after / total_before * 100:.1f} %)"
        )
    if not args.write:
        print("\n(simulation — relancer avec --write pour appliquer)")

    return 1 if over_budget else 0


if __name__ == "__main__":
    sys.exit(main())
