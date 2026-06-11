#!/usr/bin/env python3
"""Refresh Multi brand + desktop icons from a master SVG or PNG.

Requires: Python 3.11+, Pillow (`python3 -m pip install pillow`).
Requires: ImageMagick (`magick`) for SVG sources.
Requires (macOS only): `sips` and `iconutil` for `.icns` output.

Default source: assets/brand/multi-app-icon-source.png (transparent square app icon).
Default dev source: assets/brand/multi-app-icon-dev-source.png (rough development app icon).

Writes:
  - assets/brand/generated/* (canonical generated brand assets)
  - packages/desktop/resources/icon.png, icon.icns, icon.ico, and dev-dock-icon.png
    (canonical desktop artwork)
  - packages/app/public/* (dev web favicon and touch icon mirrors)

To refresh desktop icons after editing `assets/brand/multi-app-icon-source.png` or
`assets/brand/multi-app-icon-dev-source.png`:

  python3 scripts/sync-brand-icons-from-source.py
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image
except ImportError as e:  # pragma: no cover
    raise SystemExit("Install Pillow: python3 -m pip install pillow") from e

MASTER_SIZE = 1024
DOCK_ICON_SIZE = 256
DOCK_ICON_CONTENT_SIZE = 210
ICO_SIZES = (16, 32, 48, 64, 128, 256)
ICNS_BASE_SIZES = (16, 32, 128, 256, 512)

# Opacity of the blueprint veil (0-1) for dev channel raster assets.
DEV_BLUEPRINT_VEIL_STRENGTH = 0.28
DEV_BLUEPRINT_RGB = (38, 118, 245)


def master_1024(source: Path) -> Image.Image:
    if source.suffix.lower() == ".svg":
        return render_svg_1024(source)
    im = Image.open(source).convert("RGBA")
    return im.resize((MASTER_SIZE, MASTER_SIZE), Image.Resampling.LANCZOS)


def render_svg_1024(source: Path) -> Image.Image:
    magick = shutil.which("magick")
    if magick is None:
        raise SystemExit("Install ImageMagick: SVG sources require the `magick` command.")
    with tempfile.TemporaryDirectory(prefix="multi-svg-raster-") as tmp:
        out = Path(tmp) / "source-1024.png"
        subprocess.run(
            [
                magick,
                "-background",
                "none",
                "-density",
                "384",
                str(source),
                "-resize",
                f"{MASTER_SIZE}x{MASTER_SIZE}",
                f"png32:{out}",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return Image.open(out).convert("RGBA")


def apply_nonprod_blueprint_veil(
    rgba: Image.Image,
    rgb: tuple[int, int, int],
    veil_strength: float,
) -> Image.Image:
    """Tint opaque icon pixels with a cool veil; leave full transparency untouched."""
    base = rgba.convert("RGBA")
    if not 0.0 <= veil_strength <= 1.0:
        raise ValueError("veil_strength must be between 0 and 1")
    r, g, b = rgb
    tint = Image.new("RGBA", base.size, (r, g, b, 0))
    content_a = base.getchannel("A")
    veil_alpha = content_a.point(lambda p: int(round(p * veil_strength)))
    tint.putalpha(veil_alpha)
    return Image.alpha_composite(base, tint).convert("RGBA")


def write_png(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)


def macos_dock_icon(source: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", (DOCK_ICON_SIZE, DOCK_ICON_SIZE), (0, 0, 0, 0))
    content = source.resize((DOCK_ICON_CONTENT_SIZE, DOCK_ICON_CONTENT_SIZE), Image.Resampling.LANCZOS)
    offset = (DOCK_ICON_SIZE - DOCK_ICON_CONTENT_SIZE) // 2
    canvas.alpha_composite(content, (offset, offset))
    return canvas


def write_ico(path: Path, master: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    images = [master.resize((s, s), Image.Resampling.LANCZOS) for s in ICO_SIZES]
    images[0].save(
        path,
        format="ICO",
        sizes=[(img.width, img.height) for img in images],
        append_images=images[1:],
    )


def write_icns_macos(source_png: Path, target_icns: Path) -> None:
    if sys.platform != "darwin":
        print("Skipping icon.icns: not macOS (sips/iconutil unavailable).", file=sys.stderr)
        return
    target_icns.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="multi-icns-") as tmp:
        iconset = Path(tmp) / "icon.iconset"
        iconset.mkdir()
        for size in ICNS_BASE_SIZES:
            subprocess.run(
                [
                    "sips",
                    "-z",
                    str(size),
                    str(size),
                    str(source_png),
                    "--out",
                    str(iconset / f"icon_{size}x{size}.png"),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            retina = size * 2
            subprocess.run(
                [
                    "sips",
                    "-z",
                    str(retina),
                    str(retina),
                    str(source_png),
                    "--out",
                    str(iconset / f"icon_{size}x{size}@2x.png"),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(target_icns)],
            check=True,
            capture_output=True,
            text=True,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "source",
        nargs="?",
        default=None,
        help="Source SVG or PNG (default: <repo>/assets/brand/multi-app-icon-source.png)",
    )
    parser.add_argument(
        "--dev-source",
        default=None,
        help=(
            "Development source SVG or PNG "
            "(default: <repo>/assets/brand/multi-app-icon-dev-source.png if present)"
        ),
    )
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[1]
    default_source = repo / "assets" / "brand" / "multi-app-icon-source.png"
    default_dev_source = repo / "assets" / "brand" / "multi-app-icon-dev-source.png"
    source = Path(args.source).expanduser() if args.source else default_source
    if not source.is_file():
        print(f"Missing source SVG or PNG: {source}", file=sys.stderr)
        return 1
    dev_source = Path(args.dev_source).expanduser() if args.dev_source else default_dev_source

    master = master_1024(source)
    if dev_source.is_file():
        master_dev = master_1024(dev_source)
    else:
        master_dev = apply_nonprod_blueprint_veil(
            master,
            DEV_BLUEPRINT_RGB,
            DEV_BLUEPRINT_VEIL_STRENGTH,
        )
    desktop_res = repo / "packages" / "desktop" / "resources"

    with tempfile.TemporaryDirectory(prefix="multi-icon-src-") as tmp:
        tmp1024 = Path(tmp) / "master-1024.png"
        tmp_dev_1024 = Path(tmp) / "master-dev-1024.png"
        write_png(tmp1024, master)
        write_png(tmp_dev_1024, master_dev)

        write_png(desktop_res / "icon.png", master)
        write_png(desktop_res / "dev-dock-icon.png", macos_dock_icon(master_dev))
        write_icns_macos(tmp1024, desktop_res / "icon.icns")
        write_ico(desktop_res / "icon.ico", master)

        brand = repo / "assets" / "brand" / "generated"
        prod = brand / "prod"
        write_icns_macos(tmp1024, prod / "multi-production-macos-icon.icns")
        write_png(prod / "multi-production-desktop-icon-1024.png", master)
        write_png(prod / "multi-production-linux-icon-1024.png", master)
        write_png(prod / "multi-production-splash-icon-180.png", _resize(master, 180))
        write_png(prod / "black-macos-1024.png", master)
        write_png(prod / "black-universal-1024.png", master)
        write_png(prod / "black-ios-1024.png", master)
        write_png(prod / "multi-black-web-apple-touch-180.png", _resize(master, 180))
        write_png(prod / "multi-black-web-favicon-16x16.png", _resize(master, 16))
        write_png(prod / "multi-black-web-favicon-32x32.png", _resize(master, 32))
        write_ico(prod / "multi-black-web-favicon.ico", master)

        dev = brand / "dev"
        write_icns_macos(tmp_dev_1024, dev / "multi-development-macos-icon.icns")
        write_png(dev / "multi-development-desktop-icon-1024.png", master_dev)
        write_png(dev / "multi-development-dock-icon-256.png", macos_dock_icon(master_dev))
        write_png(dev / "multi-development-splash-icon-180.png", _resize(master_dev, 180))
        write_png(dev / "blueprint-macos-1024.png", master_dev)
        write_png(dev / "blueprint-universal-1024.png", master_dev)
        write_png(dev / "blueprint-ios-1024.png", master_dev)
        write_png(dev / "blueprint-web-apple-touch-180.png", _resize(master_dev, 180))
        write_png(dev / "blueprint-web-favicon-16x16.png", _resize(master_dev, 16))
        write_png(dev / "blueprint-web-favicon-32x32.png", _resize(master_dev, 32))
        write_ico(dev / "blueprint-web-favicon.ico", master_dev)

        # Vite dev serves `packages/app/public` directly (no server dist/client copy). Mirror dev web
        # icons so the browser + boot shell pick up the blueprint-tinted assets immediately.
        web_public = repo / "packages" / "app" / "public"
        dev_base = dev
        shutil.copyfile(dev_base / "blueprint-web-favicon.ico", web_public / "favicon.ico")
        shutil.copyfile(dev_base / "blueprint-web-favicon-16x16.png", web_public / "favicon-16x16.png")
        shutil.copyfile(dev_base / "blueprint-web-favicon-32x32.png", web_public / "favicon-32x32.png")
        shutil.copyfile(dev_base / "multi-development-splash-icon-180.png", web_public / "apple-touch-icon.png")

    print("Updated assets/brand/generated, desktop resources, and app public icons.")
    return 0


def _resize(im: Image.Image, size: int) -> Image.Image:
    return im.resize((size, size), Image.Resampling.LANCZOS)


if __name__ == "__main__":
    raise SystemExit(main())
