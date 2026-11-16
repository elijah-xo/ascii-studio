# Turn a photo into the brand dot map on the hand's lattice: bright -> '#', mid -> '.', dark -> ' '.
# usage: [BLUR=4 MIX=0.7] photo_dots.py IMAGE OUT.txt ROWS [top% mid%]
#   top%  = share of foreground cells that become bright '#'  (bust used 58)
#   mid%  = share that become at least dim '.'               (bust used 86)
#   BLUR  = gaussian blur before sampling (6 for the bust); MIX = local-contrast strength (0.6 for the bust)
#   Expects a subject on a dark background (fg = luminance > 0.12). Otherwise isolate it: ISO="lo,hi[,notblue][,invert]"
#   (e.g. ISO=0.38,0.63,notblue lifts pale figures off blue stone), or cut it out first.
import json, os, sys, numpy as np
from PIL import Image, ImageFilter
L = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'lattice.json'))); P, Q = L['px'], L['py']


def photo_to_map(image, rows, top=50, mid=85, blur=4, mix=0.7, iso=None, cutoff=0.12, feather=0):
    """Return the text map and column count, shared by the CLI and local editor."""
    if iso:                       # ISO="lo,hi[,notblue][,invert]": isolate the subject from its background
        rgb = np.asarray(image.convert('RGB')).astype(float) / 255
        o = iso.split(','); lo, hi = float(o[0]), float(o[1]); lum = rgb.mean(2)
        if 'invert' in o: lum = 1 - lum
        m = np.clip((lum - lo) / (hi - lo), 0, 1)
        if 'notblue' in o: m *= np.clip(1 - (rgb[:, :, 2] - rgb[:, :, 0] - 0.06) / 0.12, 0, 1)
        im = Image.fromarray((m * lum * 255).astype(np.uint8))
    else:
        im = image.convert('L')
    H = rows * Q; k = H / im.height; W = im.width * k
    a = np.asarray(im.resize((int(W), int(H)), Image.LANCZOS).filter(ImageFilter.GaussianBlur(blur))).astype(float) / 255
    from scipy import ndimage
    fg = a > cutoff
    MIX = mix; local = a - MIX * ndimage.gaussian_filter(a, 60) + MIX / 2            # local contrast: shading inside the white stone shows
    local = np.where(fg, local, 0)
    if feather:
        local *= np.clip((a - cutoff) / feather, 0, 1)
    cols = int(W / P)
    vals = local[fg]
    if not vals.size: raise ValueError("No visible subject found. Try a brighter image or invert the tones.")
    hi = np.percentile(vals, 100 - top)
    mid = np.percentile(vals, 100 - mid)
    a = local
    g = []
    for j in range(rows):
        y = int((j + 0.5) * Q); line = ''
        for i in range(cols):
            x = int((i + 0.5) * P)
            v = a[max(0, y - 12):y + 13, max(0, x - 7):x + 8].mean()
            line += '#' if v > hi else ('.' if v > mid else ' ')
        g.append(line.rstrip())
    if not any('#' in line or '.' in line for line in g):
        raise ValueError("These settings produced no dots. Increase coverage, reduce background removal, or try different tones.")
    return '\n'.join(g) + '\n', cols


if __name__ == '__main__':
    src, out, rows = sys.argv[1], sys.argv[2], int(sys.argv[3])
    with Image.open(src) as image:
        text, cols = photo_to_map(
            image, rows,
            float(sys.argv[4] if len(sys.argv) > 4 else 50),
            float(sys.argv[5] if len(sys.argv) > 5 else 85),
            float(os.environ.get('BLUR', 4)), float(os.environ.get('MIX', 0.7)),
            os.environ.get('ISO'),
        )
    with open(out, 'w') as output:
        output.write(text)
    print(cols, rows)
