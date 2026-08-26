const { _URL } = require('./functionsExport');

// Information about the image selected to be cropped
const inputImage = {
    selectedImage: document.getElementById('selectedImage'), // Input file DOM element
    file: null, // Quick access to the selected file
    img: null, // Image object that stores the image src
    width: 0,
    height: 0,
    objectUrl: null, // Active blob: URL for `file`, tracked so it can be revoked before the next one is created
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
    loadFile: function() { // Point img.src at the current `file`, revoking the previous blob: URL first
        if (inputImage.objectUrl) _URL.revokeObjectURL(inputImage.objectUrl);
        inputImage.objectUrl = _URL.createObjectURL(inputImage.file);
        inputImage.img.src = inputImage.objectUrl;
    }
}

inputImage.img = new Image();
inputImage.img.onerror = function() {
    alert("Please select an image.\n\nInvalid file type: " + inputImage.file.type);
};

module.exports = inputImage;