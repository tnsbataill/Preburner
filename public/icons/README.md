# Preburner PWA Icon Placeholders

The `.png` files in this directory are plain-text placeholders so the CI/build
pipeline can reference the expected filenames without shipping binary assets
from the agent environment.

Before releasing, replace each placeholder with the actual exported PNG icon of
the indicated dimensions:

- `icon-192.png` – 192×192 standard icon
- `icon-512.png` – 512×512 standard icon
- `icon-maskable-192.png` – 192×192 maskable icon with safe padding
- `icon-maskable-512.png` – 512×512 maskable icon with safe padding

All icons should follow the PWA manifest recommendations (square canvas,
transparent background for maskable variants) and live in this directory with
the same filenames referenced by `public/manifest.webmanifest`.
