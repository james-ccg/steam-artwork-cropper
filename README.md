# Image Cropper for Steam Artwork Showcase

A tool that measures and crops images for the Steam Artwork and Workshop showcases. It renders your image inside a pixel-accurate recreation of the Steam profile page, so you can see exactly how the crop will look before uploading it to Steam. Static images and animated GIFs are both supported.

Every exported file is kept under Steam's 5MB upload limit automatically: oversized images are re-compressed, and oversized GIFs have frames progressively dropped (preserving overall playback duration) until they fit, or the app tells you it couldn't get there.

by [xdjames](https://github.com/james-ccg)

## Usage

```shell
npm install
npm run build
```

This produces a production build in `dist/steam/js`. Serve the `dist` folder with a local web server (e.g. the Live Server extension for VS Code) and open `index.html` from there — opening it directly via `file://` isn't supported, some assets won't load correctly.

## Scripts

- `npm run build` — one-off, minified production build
- `npm run watch` — development build that automatically rebuilds on file changes
- `npm run serve` — serve the bundle with webpack-dev-server
