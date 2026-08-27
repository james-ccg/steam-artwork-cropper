// Plain-text upload guide bundled into every exported zip's readme.txt, so
// the steps still work offline / without finding the site again. The full
// version (with the Guide Showcase section, copy buttons, etc.) lives at
// dist/faq/index.html under "Uploading to Steam".
module.exports = `Every image in this zip has already been hexified - a small per-format
byte tweak (GIF 0x21, JPEG 0xDA, PNG a crafted trailing block, WebP a RIFF size
bump) that no decoder reads - so it renders at full size on Steam's showcases.
Animated .webm / .mp4 pieces need no tweak and are included untouched.
Just upload as-is.

HOW TO UPLOAD TO STEAM
Full guide: https://james-ccg.github.io/cropper/faq/#upload-guide

Artwork, Screenshot, and Workshop Showcase images don't have a normal upload
button - Steam reuses its Guide image editor for them via a one-line console
command that tells it which showcase type and size you actually mean.

1. Open https://steamcommunity.com/sharedfiles/edititem/767/3/
2. Select your image
3. Right-click the page -> Inspect -> the Console tab
4. Paste the matching line below and press Enter
5. Click Save and Continue

Artwork Showcase:
$J('#image_width').val(1000),$J('#image_height').val(1);

Screenshot Showcase:
$J('#image_width').val(1000),$J('#image_height').val(1),$J('[name=file_type]').val(5);

Workshop Showcase:
$J('[name=consumer_app_id]').val(480),$J('[name=file_type]').val(0),$J('[name=visibility]').val(0);

(Guide Showcase, including the icon and long-guide variants, is at the full
FAQ link above.)

by xdjames - https://steamcommunity.com/id/james_ccg/
`;
