const { _URL } = require('./functionsExport');

// Information about the image selected to be cropped
const inputImage = {
    selectedImage: document.getElementById('selectedImage'), // Input file DOM element
    file: null, // Quick access to the selected file
    sourceUrl: null, // URL the file was fetched from (for the slice-layout share link); null for a picked file
    img: null, // Image object that stores the image src
    width: 0,
    height: 0,
    objectUrl: null, // Active blob: URL for `file`
    objectUrlFile: null, // The File `objectUrl` was minted for - see loadFile
    // Bundled demo images run through this exact same pipeline on first load
    // (see demoDefaults.js) so the "before you upload anything" preview is a
    // real crop rather than a hand-approximated placeholder - but that means
    // a plain `file` check can't tell a demo load from a real one. This flag
    // can, and setStatusMsg below uses it so the status line stays on its
    // starting text instead of announcing "Done" for work the user never
    // asked for. Lives here (rather than in demoDefaults.js, which already
    // depends on this module) so setStatusMsg can check it without a
    // require cycle.
    userProvidedImage: false,
    markUserProvidedImage: function() {
        inputImage.userProvidedImage = true;
    },
    setStatusMsg: function(message) { // Show status of what is going on in the background
        if (!inputImage.userProvidedImage) return;
        document.getElementById('statusMsg').innerText = message;
    },
    // Point img.src at the current `file`. One blob: URL per File, kept for as
    // long as that File is the one loaded.
    //
    // This used to mint a fresh URL and revoke the previous one on every call,
    // which is wrong because three long-lived surfaces borrow the URL rather
    // than copying the pixels: the mock's page background (profilePreview), the
    // Background Cropper's preview image - and through it every slice fill and
    // the painted avatar - and the Artwork Creator's two gif previews. Each
    // format loads its own demo image the first time it is opened, so simply
    // switching format revoked a URL those surfaces were still pointing at.
    //
    // Nothing appeared to break, because an image that has already decoded
    // keeps painting from its raster. It breaks the moment something forces a
    // re-decode - which is exactly what changing the Zoom does, since every
    // element is suddenly painted at a new scale. That is why the avatar went
    // blank and fell back to Steam's blue placeholder only when zoomed.
    loadFile: function() {
        if (inputImage.file !== inputImage.objectUrlFile) {
            if (inputImage.objectUrl) _URL.revokeObjectURL(inputImage.objectUrl);
            inputImage.objectUrl = _URL.createObjectURL(inputImage.file);
            inputImage.objectUrlFile = inputImage.file;
        }
        // An <img> fires no load event when src is assigned the value it
        // already holds, and every format's pipeline hangs off that event, so
        // re-opening a format with the file it already has would leave it
        // waiting forever. Hand it the event instead.
        if (inputImage.img.src === inputImage.objectUrl && inputImage.img.complete) {
            setTimeout(function() {
                inputImage.img.dispatchEvent(new Event('load'));
            }, 0);
            return;
        }
        inputImage.img.src = inputImage.objectUrl;
    }
}

inputImage.img = new Image();
// The browser could not decode the file. Named by the file rather than its
// MIME type: the type is only what the extension claims, so a broken or
// mislabelled file used to be reported as "Invalid file type: image/png" -
// a PNG being rejected for being a PNG.
inputImage.img.onerror = function() {
    const name = inputImage.file && inputImage.file.name ? '"' + inputImage.file.name + '"' : 'That file';
    alert(name + " couldn't be read as an image.\n\nPick a PNG, JPG, GIF or WebP - or a .webm / .mp4 for an animated background.");
};

module.exports = inputImage;