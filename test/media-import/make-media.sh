#!/usr/bin/env bash
#
# Regenerate the media-import test corpus used by TESTING.csv.
#
#   bash test/media-import/make-media.sh
#
# Writes into public/__testmedia/ (gitignored — the corpus is ~2.2 GB) and
# copies the browser harness in beside it so the editor can load it over HTTP.
# Requires ffmpeg on PATH.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/public/__testmedia"
FF="ffmpeg -hide_banner -loglevel error -y"

mkdir -p "$OUT"
cd "$OUT"

echo "==> video containers / codecs"
$FF -f lavfi -i testsrc=size=640x360:rate=30:duration=5 -f lavfi -i sine=frequency=440:duration=5 \
    -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest h264_aac.mp4
$FF -f lavfi -i testsrc=size=640x360:rate=30:duration=5 -c:v libx264 -pix_fmt yuv420p -an h264_noaudio.mp4
$FF -f lavfi -i testsrc=size=320x240:rate=24:duration=4 -f lavfi -i sine=frequency=330:duration=4 \
    -c:v libvpx-vp9 -b:v 300k -c:a libopus -shortest vp9_opus.webm
$FF -f lavfi -i testsrc=size=640x360:rate=30:duration=4 -f lavfi -i sine=frequency=440:duration=4 \
    -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest h264.mov
$FF -f lavfi -i testsrc=size=320x240:rate=25:duration=4 -c:v mpeg4 -vtag XVID -an mpeg4.avi
$FF -f lavfi -i testsrc=size=640x360:rate=30:duration=4 -f lavfi -i sine=frequency=440:duration=4 \
    -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest h264.mkv
$FF -f lavfi -i testsrc=size=640x360:rate=30:duration=4 -c:v libx265 -pix_fmt yuv420p -tag:v hvc1 -an hevc.mp4

echo "==> audio codecs"
$FF -f lavfi -i sine=frequency=440:duration=6 -c:a libmp3lame -b:a 128k audio.mp3
$FF -f lavfi -i sine=frequency=440:duration=6 -c:a pcm_s16le            audio.wav
$FF -f lavfi -i sine=frequency=440:duration=6 -c:a aac -b:a 128k        audio.m4a
$FF -f lavfi -i sine=frequency=440:duration=6 -c:a flac                 audio.flac
$FF -f lavfi -i sine=frequency=440:duration=6 -c:a libvorbis            audio.ogg
$FF -f lavfi -i sine=frequency=440:duration=6 -c:a libopus             audio.opus

echo "==> images"
$FF -f lavfi -i testsrc=size=800x600:duration=1 -frames:v 1 image.png
$FF -f lavfi -i testsrc=size=800x600:duration=1 -frames:v 1 image.jpg
$FF -f lavfi -i testsrc=size=800x600:duration=1 -frames:v 1 image.webp
$FF -f lavfi -i testsrc=size=200x150:rate=10:duration=2         image_anim.gif
$FF -f lavfi -i testsrc=size=320x240:duration=1 -frames:v 1 image.bmp
cat > image.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect width="400" height="300" fill="#2b5797"/>
  <circle cx="200" cy="150" r="80" fill="#ffb900"/>
  <text x="200" y="160" font-size="32" text-anchor="middle" fill="#fff">ForgeCut</text>
</svg>
SVG

echo "==> JPEG with EXIF Orientation=6"
$FF -f lavfi -i testsrc=size=640x480:duration=1 -frames:v 1 exif_rot.jpg
python - <<'PY'
import struct
p = "exif_rot.jpg"
d = open(p, 'rb').read()
tiff = b'II*\x00' + struct.pack('<I', 8) + struct.pack('<H', 1) \
     + struct.pack('<HHIHH', 0x0112, 3, 1, 6, 0) + struct.pack('<I', 0)
app1 = b'Exif\x00\x00' + tiff
seg = b'\xff\xe1' + struct.pack('>H', len(app1) + 2) + app1
open(p, 'wb').write(d[:2] + seg + d[2:])
PY

echo "==> filename edge cases"
cp h264_aac.mp4 "my holiday video (final).mp4"
cp h264_aac.mp4 "ビデオ_测试_🎬_café.mp4"
cp audio.mp3    "song – naïve #1 & 2.mp3"
cp image.png    "screenshot 2024-01-01 at 12.34.56.png"

echo "==> invalid / corrupt"
: > empty.mp4                                   # 0 bytes
head -c 40000 h264_aac.mp4 > truncated.mp4      # truncated container
printf 'this is definitely not a video file at all' > garbage.mp4
cp image.png   notavideo.mp4                    # PNG bytes, .mp4 extension
cp h264_aac.mp4 noextension                     # valid MP4, no extension
head -c 1 image.png > tiny.jpg                  # 1 byte

echo "==> font"
cp /c/Windows/Fonts/arial.ttf testfont.ttf 2>/dev/null \
  || cp /c/Windows/Fonts/segoeui.ttf testfont.ttf 2>/dev/null \
  || echo "   (no system TTF found; skipping testfont.ttf)"

echo "==> large files (noise source: does not compress)"
$FF -f lavfi -i "nullsrc=s=1280x720:r=30:d=30,geq=random(1)*255:128:128" \
    -f lavfi -i sine=frequency=440:duration=30 \
    -c:v libx264 -preset ultrafast -qp 20 -pix_fmt yuv420p -c:a aac -shortest large_1080p.mp4
$FF -f lavfi -i "nullsrc=s=1920x1080:r=30:d=20,geq=random(1)*255:128:128" \
    -f lavfi -i sine=frequency=440:duration=20 \
    -c:v libx264 -preset ultrafast -qp 8 -pix_fmt yuv420p -c:a aac -shortest oversize_1_7gb.mp4

echo "==> harnesses + bulk CSV fixture"
cp "$HERE/harness.js" "$OUT/harness.js"
cp "$HERE/ribbon-audit.js" "$OUT/ribbon-audit.js"
cat > "$OUT/bulk.csv" <<'CSV'
name,title,price
Alice,Spring Sale,19.99
Bob,Summer Deal,29.99
Cara,Winter Promo,39.99
CSV

echo
echo "Done. $(ls -1 "$OUT" | wc -l) files, $(du -sh "$OUT" | cut -f1) in $OUT"
echo "See test/media-import/README.md for how to drive the matrix."
