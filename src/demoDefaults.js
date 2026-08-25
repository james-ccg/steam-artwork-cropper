// Runs this app's own bundled example images through the real crop pipeline
// on first load, instead of showing a hand-approximated placeholder image -
// the "before you upload anything" preview is a real, correctly-measured
// crop because it *is* a crop, done by the same code a real upload uses.
const inputImage = require('./inputImage');

let userHasProvidedImage = false;

function markUserProvidedImage() {
	userHasProvidedImage = true;
}

async function fetchAsFile(url) {
	const response = await fetch(url);
	const blob = await response.blob();
	return new File([blob], url.split('/').pop(), { type: blob.type });
}

// If the user hasn't picked their own image yet, loads the given demo image
// into inputImage.file before calling loadImageFn - once they have, this is
// a no-op and loadImageFn just runs against whatever they provided instead.
async function loadDefault(url, loadImageFn) {
	if (!userHasProvidedImage) {
		inputImage.file = await fetchAsFile(url);
	}
	loadImageFn();
}

module.exports = {
	markUserProvidedImage,
	loadDefaultFeatured: (loadImageFn) => loadDefault('./steam/imgs/1.jpg', loadImageFn),
	loadDefaultArtwork: (loadImageFn) => loadDefault('./steam/imgs/1.jpg', loadImageFn),
	loadDefaultWorkshop: (loadImageFn) => loadDefault('./steam/imgs/nero.jpg', loadImageFn),
	loadDefaultAvatar: (loadImageFn) => loadDefault('./steam/imgs/1.jpg', loadImageFn),
};
