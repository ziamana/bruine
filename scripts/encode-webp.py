"""Animated WebP where every frame is a keyframe: no reused blocks, so no mosaic builds up on dark backgrounds.

ffmpeg's libwebp_anim lets the encoder rebuild unchanged 8x8 blocks from earlier frames; on the film's
night background those approximations pile up into a visible mosaic. Needs `pip install webp numpy`.

    python scripts/encode-webp.py <video> <out.webp> <start s> <length s> <width> <fps> <quality> [crop w:h:x:y]

docs/media/hero.webp:   bruine-short.mp4 0 14.2 960 15 80
docs/media/effort.webp: docs/media/bruine-film.mp4 26.4 4.1 960 15 80
site/public/media/effort-max.webp: docs/media/bruine-film.mp4 28.3 2.2 760 15 80 940:370:170:270
"""
import subprocess, sys
import numpy as np
import webp

src, out, start, length, width, fps, quality = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]), float(sys.argv[7])
crop = sys.argv[8] if len(sys.argv) > 8 else None
vf = (f"crop={crop}," if crop else "") + f"scale={width}:-2:flags=lanczos,fps={fps}"
probe = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(length), "-i", src, "-vf", vf, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True, check=True).stdout
import struct
w, h = struct.unpack(">II", probe[16:24])
raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(length), "-i", src, "-vf", vf, "-pix_fmt", "rgba", "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, h, w, 4)
opts = webp.WebPAnimEncoderOptions.new(minimize_size=False, allow_mixed=False)
opts.ptr.kmin = 0
opts.ptr.kmax = 1
opts.loop_count = 0
enc = webp.WebPAnimEncoder.new(w, h, opts)
cfg = webp.WebPConfig.new(preset=webp.WebPPreset.PICTURE, quality=quality)
cfg.ptr.method = 6
step = int(round(1000 / fps))
for i, frame in enumerate(frames):
    enc.encode_frame(webp.WebPPicture.from_numpy(np.ascontiguousarray(frame)), i * step, cfg)
data = enc.assemble(len(frames) * step)
with open(out, "wb") as f:
    f.write(data.buffer())
print(f"{out}: {len(frames)} frames {w}x{h}, {len(data.buffer()) / 1e6:.2f} MB")
