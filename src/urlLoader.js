const inputImage = require('./inputImage');
const { fetchImageAsFile } = require('./loadFromUrl');
const profilePreview = require('./profilePreview');

// Wires the "paste a background URL" box next to the file picker so people
// can crop a Steam background straight from its image link instead of
// downloading it first. The fetched image becomes a File and is handed to
// the same loader the file picker uses (`loadNewFile`, from
// artworkCropper.js), so nothing downstream needs to know the image didn't
// come from a local upload.
function setupUrlLoader(loadNewFile) {
	const input = document.getElementById('bgUrlInput');
	const button = document.getElementById('loadBgUrlBtn');
	if (!input || !button) return;

	async function load() {
		const url = input.value.trim();
		if (!url) return;
		button.disabled = true;
		inputImage.markUserProvidedImage();
		inputImage.setStatusMsg('Loading image from URL...');
		try {
			const file = await fetchImageAsFile(url);
			loadNewFile(file);
		} catch (err) {
			inputImage.setStatusMsg(`Couldn't load that URL - ${err.message}`);
		} finally {
			button.disabled = false;
		}
	}

	button.addEventListener('click', load);
	input.addEventListener('keydown', function (e) {
		if (e.key === 'Enter') load();
	});

	// ?bg=<url> lets the Backgrounds page link straight into a ready-to-crop
	// image instead of making people copy/paste the link themselves. Anyone
	// arriving that way came from the Backgrounds gallery to crop a profile
	// background, so land them in Background Cropper mode rather than the
	// default Artwork Creator mode.
	const bg = new URLSearchParams(window.location.search).get('bg');
	if (bg) {
		input.value = bg;
		if (profilePreview.getMode() !== 'cropper') profilePreview.setMode('cropper');
		load();
	}
}

module.exports = setupUrlLoader;
