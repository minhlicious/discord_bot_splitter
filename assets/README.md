# assets/

Place a **256×256 `icon.ico`** here before running `pnpm run build`.

The ico file is required by electron-builder for the Windows installer and portable exe.
You can convert any PNG at https://icoconvert.com or use ImageMagick:

```
magick icon.png -define icon:auto-resize=256,128,64,32,16 icon.ico
```

The icon is **not** needed for `pnpm start` (development mode).
