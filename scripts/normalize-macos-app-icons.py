#!/usr/bin/env python3
"""Normalize app-icon PNG exports (e.g. from Paper) to the macOS master standard.

Takes square icon exports whose rounded-tile corners are baked onto an opaque
(white) artboard background, and produces 1024x1024 RGBA masters with truly
transparent rounded corners — no white fringes in the Dock, Finder, or
Quick Look.

Requires: Python 3.11+, Pillow (`python3 -m pip install pillow`).

Usage:
  python3 scripts/normalize-macos-app-icons.py [files...]

Default input: ~/Downloads/Icon*.png (Paper artboard exports). Files are
normalized in place, and variants are mirrored into:
  - assets/brand/variants/generated/honk-icon-<variant>-1024.png
  - packages/desktop/resources/app-icons/<variant>.png (256px dock icon)
  - packages/app/public/app-icons/<variant>.png (settings preview)
The Classic icon is canonical in the repo already
(assets/brand/honk-app-icon-source.svg), so it is fixed in place but not
mirrored; its dock/preview assets come from the existing sync script.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError as e:  # pragma: no cover
    raise SystemExit("Install Pillow: python3 -m pip install pillow") from e

MASTER_SIZE = 1024
# Keep in sync with scripts/sync-brand-icons-from-source.py macos_dock_icon().
DOCK_ICON_SIZE = 256
DOCK_ICON_CONTENT_SIZE = 210
# The brand tile's corner radius measured from the classic master is ~223px at
# 1024. Cut slightly deeper so antialiased background pixels can't survive at
# the rim.
TILE_CORNER_RADIUS = 228
SUPERSAMPLE = 4


def rounded_tile_mask(size: int, radius: int) -> Image.Image:
    big = size * SUPERSAMPLE
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=radius * SUPERSAMPLE, fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def normalize(source: Path) -> Image.Image:
    im = Image.open(source).convert("RGBA")
    if im.width != im.height:
        raise SystemExit(f"{source.name}: expected a square export, got {im.width}x{im.height}")
    im = im.resize((MASTER_SIZE, MASTER_SIZE), Image.Resampling.LANCZOS)
    mask = rounded_tile_mask(MASTER_SIZE, TILE_CORNER_RADIUS)
    alpha = Image.composite(im.getchannel("A"), Image.new("L", im.size, 0), mask)
    im.putalpha(alpha)
    return im


def macos_dock_icon(master: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", (DOCK_ICON_SIZE, DOCK_ICON_SIZE), (0, 0, 0, 0))
    content = master.resize(
        (DOCK_ICON_CONTENT_SIZE, DOCK_ICON_CONTENT_SIZE), Image.Resampling.LANCZOS
    )
    offset = (DOCK_ICON_SIZE - DOCK_ICON_CONTENT_SIZE) // 2
    canvas.alpha_composite(content, (offset, offset))
    return canvas


def variant_slug(source: Path) -> str:
    name = source.stem
    name = re.sub(r"@\d+x$", "", name)
    name = name.split("—")[-1] if "—" in name else name
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def main() -> int:
    args = [Path(a).expanduser() for a in sys.argv[1:]]
    sources = args or sorted(Path("~/Downloads").expanduser().glob("Icon*.png"))
    if not sources:
        print("No input PNGs found.", file=sys.stderr)
        return 1

    repo = Path(__file__).resolve().parents[1]
    generated = repo / "assets" / "brand" / "variants" / "generated"
    dock_icons = repo / "packages" / "desktop" / "resources" / "app-icons"
    previews = repo / "packages" / "app" / "public" / "app-icons"

    for source in sources:
        master = normalize(source)
        master.save(source, optimize=True)
        slug = variant_slug(source)
        if slug == "classic":
            print(f"{source.name} -> normalized in place (classic stays canonical in repo)")
            continue
        for path in (
            generated / f"honk-icon-{slug}-1024.png",
            dock_icons / f"{slug}.png",
            previews / f"{slug}.png",
        ):
            path.parent.mkdir(parents=True, exist_ok=True)
            image = master if path.parent == generated else macos_dock_icon(master)
            image.save(path, optimize=True)
        print(f"{source.name} -> normalized in place + generated/dock/preview assets for '{slug}'")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
