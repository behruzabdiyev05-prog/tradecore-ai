"""
Generates the original background scenes used by the glass UI.
All artwork is procedurally generated here (no external images).

    python3 scripts/generate-backgrounds.py   → public/backgrounds/*.jpg
"""
import os
import numpy as np
from PIL import Image, ImageFilter

W, H = 1920, 1080
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'backgrounds')
rng = np.random.default_rng(7)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
Y, X = yy / H, xx / W


def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32) / 255


def vgrad(stops):
    """Vertical gradient from [(pos, '#hex'), ...]."""
    img = np.zeros((H, W, 3), np.float32)
    pos = [p for p, _ in stops]
    cols = [hexrgb(c) for _, c in stops]
    for ch in range(3):
        img[..., ch] = np.interp(Y, pos, [c[ch] for c in cols])
    return img


def glow(img, cx, cy, r, color, strength=1.0):
    d = np.sqrt(((X - cx) * W / H) ** 2 + (Y - cy) ** 2)
    a = np.exp(-(d / r) ** 2) * strength
    return img + a[..., None] * hexrgb(color)


def paint(img, mask, color, alpha=1.0):
    m = np.clip(mask, 0, 1)[..., None] * alpha
    return img * (1 - m) + hexrgb(color) * m


def ridge(base, amp, freq, seed, octaves=5):
    """1-D fractal line (y in 0..1) across the width."""
    r = np.random.default_rng(seed)
    x = np.linspace(0, 1, W)
    y = np.full(W, base, np.float32)
    a, f = amp, freq
    for _ in range(octaves):
        phase = r.uniform(0, 2 * np.pi)
        y += a * np.sin(x * f * 2 * np.pi + phase) * r.uniform(0.6, 1.0)
        a *= 0.5
        f *= 2.1
    return y


def below(line):
    return (Y >= line[None, :]).astype(np.float32)


def stars(img, n, max_y=1.0, size=1):
    px = rng.integers(0, W, n)
    py = rng.integers(0, int(H * max_y), n)
    b = rng.uniform(0.3, 1.0, n)
    for x, y, v in zip(px, py, b):
        img[y:y + size, x:x + size] = np.maximum(img[y:y + size, x:x + size], v)
    return img


def noise(scale, seed):
    r = np.random.default_rng(seed)
    small = r.random((H // scale + 2, W // scale + 2)).astype(np.float32)
    im = Image.fromarray((small * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
    im = im.filter(ImageFilter.GaussianBlur(scale * 0.6))
    a = np.asarray(im, np.float32)
    return (a - a.min()) / max(1e-6, a.max() - a.min())


def save(img, name, blur=0):
    img = np.clip(img, 0, 1)
    im = Image.fromarray((img * 255).astype(np.uint8))
    if blur:
        im = im.filter(ImageFilter.GaussianBlur(blur))
    # subtle grain
    g = (np.random.default_rng(1).normal(0, 3.0, (H, W, 1))).astype(np.float32)
    arr = np.clip(np.asarray(im, np.float32) + g, 0, 255).astype(np.uint8)
    os.makedirs(OUT, exist_ok=True)
    Image.fromarray(arr).save(os.path.join(OUT, f'{name}.jpg'), quality=80, optimize=True, progressive=True)
    print('wrote', name)


# 1. Aurora — teal/violet ribbons over a night valley
def aurora():
    img = vgrad([(0, '#050816'), (0.6, '#0b1630'), (1, '#071018')])
    img = stars(img, 900, 0.7)
    for i, (col, cy, amp, w) in enumerate([('#2de2c4', 0.30, 0.08, 0.05), ('#7c5cff', 0.22, 0.06, 0.04), ('#22c3ee', 0.38, 0.05, 0.035)]):
        line = ridge(cy, amp, 1.2, 10 + i, 3)
        d = np.abs(Y - line[None, :])
        above = np.clip((line[None, :] - Y) / 0.22, 0, 1)
        curtain = np.where(Y < line[None, :], np.exp(-above * 3.0), np.exp(-(d / w) ** 2))
        rays = 0.55 + 0.45 * noise(18, 20 + i)[0:1, :]
        img = img + (curtain * rays)[..., None] * hexrgb(col) * 0.42
    img = glow(img, 0.5, 0.35, 0.5, '#1e3a8a', 0.25)
    img = paint(img, below(ridge(0.78, 0.05, 1.5, 3)), '#0a1a24')
    img = paint(img, below(ridge(0.86, 0.04, 2.2, 4)), '#050d14')
    save(img, 'aurora', blur=2)


# 2. Ocean — moonlit layered waves
def ocean():
    img = vgrad([(0, '#03101f'), (0.45, '#0b3a66'), (0.55, '#0a2a4a'), (1, '#020a14')])
    img = glow(img, 0.72, 0.28, 0.16, '#cfe8ff', 0.9)
    img = glow(img, 0.72, 0.28, 0.5, '#2b7bd6', 0.35)
    img = stars(img, 400, 0.4)
    for i, (base, col) in enumerate([(0.55, '#0d4f86'), (0.63, '#0a3d6b'), (0.72, '#082f55'), (0.82, '#05213d'), (0.92, '#03152a')]):
        line = ridge(base, 0.014, 2 + i, 30 + i, 2)
        img = paint(img, below(line), col)
        crest = np.exp(-((Y - line[None, :]) / 0.005) ** 2) * np.exp(-((X - 0.72) / 0.16) ** 2) * 0.5
        img = img + crest[..., None] * hexrgb('#9fd3ff')
    save(img, 'ocean', blur=1.5)


# 3. Dusk mountains — violet/pink sky, layered ridges
def mountains():
    img = vgrad([(0, '#1a0b2e'), (0.4, '#5b2a6e'), (0.62, '#d0607e'), (0.75, '#f3a37a'), (1, '#2a0f2a')])
    img = glow(img, 0.35, 0.62, 0.12, '#ffd2a0', 0.9)
    layers = [(0.52, '#7a3b7a'), (0.6, '#5a2a63'), (0.68, '#401c4f'), (0.78, '#2a1238'), (0.9, '#160920')]
    for i, (base, col) in enumerate(layers):
        line = ridge(base, 0.07 - i * 0.008, 1.3 + i * 0.6, 40 + i)
        img = paint(img, below(line), col)
        haze = np.clip((Y - line[None, :]) / 0.08, 0, 1)
        img = paint(img, (1 - haze) * below(line), '#e98aa0', 0.18)
    save(img, 'mountains', blur=1.5)


# 4. Forest — emerald mist and pine silhouettes
def forest():
    img = vgrad([(0, '#03140f'), (0.4, '#0b3b2c'), (0.6, '#1f6b4f'), (1, '#04120d')])
    img = glow(img, 0.6, 0.35, 0.35, '#8ff0c4', 0.35)
    for i, (base, h, col) in enumerate([(0.62, 0.18, '#145440'), (0.72, 0.22, '#0d3b2d'), (0.85, 0.3, '#06231b')]):
        r = np.random.default_rng(50 + i)
        mask = np.zeros((H, W), np.float32)
        x = 0
        while x < W:
            tw = r.integers(28, 70) * (1 + i * 0.6)
            th = r.uniform(0.6, 1.0) * h
            top = base - th
            cx = x + tw / 2
            t = np.clip((Y - top) / th, 0, 1)
            mask = np.maximum(mask, ((np.abs(xx - cx) < t * tw / 2) & (Y >= top)).astype(np.float32))
            x += int(tw * r.uniform(0.5, 0.9))
        mask = np.maximum(mask, (Y > base).astype(np.float32))
        img = paint(img, mask, col)
        fog = np.exp(-((Y - base) / 0.05) ** 2) * (0.5 + 0.5 * noise(90, 60 + i))
        img = paint(img, fog, '#7fcfaa', 0.22)
    save(img, 'forest', blur=1.8)


# 5. City night — magenta/blue sky and lit skyline
def city():
    img = vgrad([(0, '#0a0620'), (0.45, '#2a1150'), (0.7, '#7a2a7a'), (1, '#0a0614')])
    img = glow(img, 0.5, 0.75, 0.45, '#ff4fa0', 0.35)
    img = glow(img, 0.15, 0.2, 0.3, '#3b5bff', 0.3)
    img = stars(img, 250, 0.4)
    for i, (h_min, h_max, col, win) in enumerate([(0.35, 0.55, '#1c1240', 0.06), (0.45, 0.7, '#120b2c', 0.12), (0.62, 0.82, '#08061a', 0.18)]):
        r = np.random.default_rng(70 + i)
        x = 0
        while x < W:
            bw = int(r.integers(40, 120) * (1 + i * 0.4))
            y0 = int(H * r.uniform(h_min, h_max))
            img[y0:, x:x + bw] = hexrgb(col)
            for wy in range(y0 + 8, H, 14):
                for wx in range(x + 6, x + bw - 6, 11):
                    if r.random() < win:
                        img[wy:wy + 5, wx:wx + 4] = hexrgb(r.choice(['#ffd27a', '#7ad9ff', '#ff9ad5']))
            x += bw + int(r.integers(0, 8))
    save(img, 'city', blur=1.2)


# 6. Desert — rose/amber dunes
def desert():
    img = vgrad([(0, '#2a0f24'), (0.35, '#8a3a4a'), (0.55, '#e8875f'), (0.7, '#f6c38a'), (1, '#3a1a1a')])
    img = glow(img, 0.7, 0.5, 0.09, '#fff1c9', 1.0)
    for i, (base, col) in enumerate([(0.62, '#c46a4e'), (0.7, '#a24f3f'), (0.8, '#7a3934'), (0.92, '#4a2128')]):
        line = ridge(base, 0.04, 0.8 + i * 0.5, 80 + i, 3)
        img = paint(img, below(line), col)
        lit = np.exp(-((Y - line[None, :]) / 0.02) ** 2) * 0.12 * (Y >= line[None, :])
        img = img + lit[..., None] * hexrgb('#ffd1a1')
    save(img, 'desert', blur=1.5)


# 7. Nebula — indigo/pink space clouds
def nebula():
    img = vgrad([(0, '#05030f'), (1, '#0a0520')])
    n1, n2, n3 = noise(160, 90), noise(60, 91), noise(260, 92)
    cloud = np.clip((n1 * 0.65 + n2 * 0.35) - 0.38, 0, 1) ** 1.3 * 1.9
    img = img + (cloud * n3)[..., None] * hexrgb('#ff4fa0') * 0.7
    img = img + (cloud * (1 - n3))[..., None] * hexrgb('#5b5bff') * 0.8
    img = glow(img, 0.3, 0.4, 0.35, '#8b5cf6', 0.35)
    img = glow(img, 0.8, 0.65, 0.3, '#22d3ee', 0.2)
    img = stars(img, 1400, 1.0)
    img = stars(img, 120, 1.0, size=2)
    save(img, 'nebula', blur=1.2)


if __name__ == '__main__':
    for fn in (aurora, ocean, mountains, forest, city, desert, nebula):
        fn()


def lighten_all():
    """Daylight variants (public/backgrounds/light/*.jpg): lifted, airy, saturated."""
    import colorsys  # noqa: F401  (kept simple: numpy HSV-free saturation boost)
    out = os.path.join(OUT, 'light')
    os.makedirs(out, exist_ok=True)
    for name in ('aurora', 'ocean', 'mountains', 'forest', 'city', 'desert', 'nebula'):
        a = np.asarray(Image.open(os.path.join(OUT, f'{name}.jpg')), np.float32) / 255
        # normalise per scene so each uses the full range, then lift into pastel daylight
        lo, hi = np.percentile(a, 1), np.percentile(a, 99.5)
        a = np.clip((a - lo) / max(1e-6, hi - lo), 0, 1)
        grey = a.mean(axis=2, keepdims=True)
        a = np.clip(grey + (a - grey) * 1.6, 0, 1)          # saturation boost
        a = 0.42 + 0.58 * a ** 0.75                          # lift shadows → airy
        a = np.clip(a, 0, 1)
        Image.fromarray((a * 255).astype(np.uint8)).save(os.path.join(out, f'{name}.jpg'), quality=80, optimize=True, progressive=True)
        print('wrote light/', name)


if __name__ == '__main__':
    lighten_all()
