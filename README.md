# ASCII Studio

Turn a photo into a dot portrait, then export it as a profile picture, SVG,
animated HTML, MP4, or a small website kit. ASCII Studio is a local-first browser
editor built on [0xSero's ascii-art](https://github.com/0xSero/ascii-art) engine.

## Start here

You need [Nix](https://nixos.org/download/) on x86_64 Linux. From this folder:

```bash
nix develop "path:$PWD/nix" -c python scripts/studio.py
```

Then open [http://127.0.0.1:8765](http://127.0.0.1:8765). Keep that terminal open
while you use the editor; press <kbd>Ctrl</kbd>+<kbd>C</kbd> to stop it.

If you use direnv, run `direnv allow` once. After that, `python scripts/studio.py`
is enough.

## Make your first portrait

1. Choose a JPG, PNG, or WebP image. A clear subject against a simple background
   works best.
2. Move and zoom the photo in **Source**, then tune detail and coverage in
   **Artwork**.
3. Pick a palette, check the circular PFP preview, and download a PNG or SVG.
4. Click **Animate** to add wind and dust, then download HTML, an MP4, or a
   website kit.

Use **Save project** before closing the page. It creates a `.dotstudio` file with
your source image and editing state, so keep it private. **Save settings** stores
only your controls, without the photo.

## What you can export

| Export | Best for |
| --- | --- |
| PNG | Profile pictures, social posts, and raster images |
| SVG | Websites and sharp scalable still art |
| HTML | A self-contained animated portrait |
| MP4 | Video platforms and sharing |
| Website kit ZIP | Embedding the animation in your own website |

The website kit includes an `embed.html` example and a fallback poster. It does
not include the original photo or project file.

## Your privacy

The editor listens only on your computer at `127.0.0.1`. Photos are processed in
memory and are not uploaded or saved by the app. Browser session recovery is
optional; it stores one local copy in your browser profile. A saved project is the
portable backup.

## Hosting

GitHub Pages can host exported website kits, SVGs, and PNGs. It cannot run the
full editor because converting photos and rendering MP4s require the Python
backend. Deploy the full editor to a service that can run Python and FFmpeg.

## Develop

| Area | Where to look |
| --- | --- |
| Editor interface | `web/` |
| Local API | `scripts/studio.py` |
| Image conversion | `scripts/photo_dots.py` |
| Animation rendering | `scripts/animation.py` and `assets/engine.js` |

Run the checks inside the Nix environment:

```bash
python -m unittest discover -s tests -v
node --test tests/*.test.mjs
```

## Command-line tools

The original tools are still available when you want a scriptable workflow:

```bash
# Photo → text dot map → PNG and SVG
python scripts/photo_dots.py photo.jpg map.txt 52 58 86
python scripts/render_map.py map.txt still 0.6

# Scene JSON → self-contained animation page
python scripts/build_scene.py examples/scenes/bust-dust.scene.json out.html
```

See [SKILL.md](SKILL.md) for the visual method, [references/engine.md](references/engine.md)
for the animation-scene format, and [references/case-study.md](references/case-study.md)
for a worked example.

## License

MIT — see [LICENSE](LICENSE). The license covers the code and documentation; make
sure you have the right to use any image you upload.
