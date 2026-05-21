#!/usr/bin/env python3
"""Strip flat outer background from a master PNG and refresh Multi brand + desktop icons.

Requires: Python 3.11+, Pillow (`python3 -m pip install pillow`).
Requires (macOS only): `sips` and `iconutil` for `.icns` output.

Default source: assets/app-icon-source.png (square raster; outer cream background is removed).

Writes:
  - packages/desktop/resources/icon.png and icon.icns (production artwork)
  - assets/prod/* (named desktop 1024 PNGs, legacy mobile/web PNGs + favicon ICO)
  - assets/dev/* (named desktop 1024 PNG, legacy blueprint web assets)
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from collections import deque
from pathlib import Path

try:
    from PIL import Image
except ImportError as e:  # pragma: no cover
    raise SystemExit("Install Pillow: python3 -m pip install pillow") from e

TOLERANCE = 40
MASTER_SIZE = 1024
ICO_SIZES = (16, 32, 48, 64, 128, 256)
ICNS_BASE_SIZES = (16, 32, 128, 256, 512)

# Opacity of the blueprint veil (0-1) for dev channel raster assets.
DEV_BLUEPRINT_VEIL_STRENGTH = 0.28
DEV_BLUEPRINT_RGB = (38, 118, 245)


def corner_mean_rgb(im: Image.Image, x0: int, y0: int, w: int = 3, h: int = 3) -> tuple[int, int, int]:
    px = im.load()
    r_acc = g_acc = b_acc = 0
    n = 0
    for y in range(y0, min(y0 + h, im.height)):
        for x in range(x0, min(x0 + w, im.width)):
            r, g, b = px[x, y][:3]
            r_acc += r
            g_acc += g
            b_acc += b
            n += 1
    return r_acc // n, g_acc // n, b_acc // n


def average_corner_color(im: Image.Image) -> tuple[int, int, int]:
    w, h = im.size
    patches = (
        corner_mean_rgb(im, 0, 0),
        corner_mean_rgb(im, w - 3, 0),
        corner_mean_rgb(im, 0, h - 3),
        corner_mean_rgb(im, w - 3, h - 3),
    )
    r = sum(p[0] for p in patches) // 4
    g = sum(p[1] for p in patches) // 4
    b = sum(p[2] for p in patches) // 4
    return r, g, b


def within_tolerance(rgb: tuple[int, int, int], target: tuple[int, int, int]) -> bool:
    return all(abs(rgb[i] - target[i]) <= TOLERANCE for i in range(3))


def flood_transparent_rgba(rgba: Image.Image, bg: tuple[int, int, int]) -> Image.Image:
    w, h = rgba.size
    px = rgba.load()
    visited = bytearray(w * h)

    def idx(x: int, y: int) -> int:
        return y * w + x

    q: deque[tuple[int, int]] = deque()
    for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        if 0 <= x < w and 0 <= y < h:
            q.append((x, y))

    while q:
        x, y = q.popleft()
        i = idx(x, y)
        if visited[i]:
            continue
        visited[i] = 1
        r, g, b, a = px[x, y]
        if a == 0:
            continue
        if not within_tolerance((r, g, b), bg):
            continue
        px[x, y] = (r, g, b, 0)
        if x > 0:
            q.append((x - 1, y))
        if x + 1 < w:
            q.append((x + 1, y))
        if y > 0:
            q.append((x, y - 1))
        if y + 1 < h:
            q.append((x, y + 1))
    return rgba


def master_1024(source: Path) -> Image.Image:
    im = Image.open(source).convert("RGBA")
    bg = average_corner_color(im)
    cleared = flood_transparent_rgba(im.copy(), bg)
    return cleared.resize((MASTER_SIZE, MASTER_SIZE), Image.Resampling.LANCZOS)


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
        help="Source PNG (default: <repo>/assets/app-icon-source.png)",
    )
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[1]
    default_source = repo / "assets" / "app-icon-source.png"
    source = Path(args.source).expanduser() if args.source else default_source
    if not source.is_file():
        print(f"Missing source PNG: {source}", file=sys.stderr)
        return 1

    master = master_1024(source)
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
        write_icns_macos(tmp1024, desktop_res / "icon.icns")

        prod = repo / "assets" / "prod"
        write_icns_macos(tmp1024, prod / "multi-production-macos-icon.icns")
        write_png(prod / "multi-production-desktop-icon-1024.png", master)
        write_png(prod / "multi-production-linux-icon-1024.png", master)
        write_png(prod / "black-macos-1024.png", master)
        write_png(prod / "black-universal-1024.png", master)
        write_png(prod / "black-ios-1024.png", master)
        write_png(prod / "multi-black-web-apple-touch-180.png", _resize(master, 180))
        write_png(prod / "multi-black-web-favicon-16x16.png", _resize(master, 16))
        write_png(prod / "multi-black-web-favicon-32x32.png", _resize(master, 32))
        write_ico(prod / "multi-black-web-favicon.ico", master)

        dev = repo / "assets" / "dev"
        write_icns_macos(tmp_dev_1024, dev / "multi-development-macos-icon.icns")
        write_png(dev / "multi-development-desktop-icon-1024.png", master_dev)
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
        dev_base = repo / "assets" / "dev"
        shutil.copyfile(dev_base / "blueprint-web-favicon.ico", web_public / "favicon.ico")
        shutil.copyfile(dev_base / "blueprint-web-favicon-16x16.png", web_public / "favicon-16x16.png")
        shutil.copyfile(dev_base / "blueprint-web-favicon-32x32.png", web_public / "favicon-32x32.png")
        shutil.copyfile(dev_base / "blueprint-web-apple-touch-180.png", web_public / "apple-touch-icon.png")

    print("Updated desktop resources (prod), assets/prod, and dev blueprint assets.")
    return 0


def _resize(im: Image.Image, size: int) -> Image.Image:
    return im.resize((size, size), Image.Resampling.LANCZOS)


if __name__ == "__main__":
    raise SystemExit(main())
