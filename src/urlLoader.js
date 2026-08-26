const inputImage = require('./inputImage');
const { fetchImageAsFile } = require('./loadFromUrl');
const profilePreview = require('./profilePreview');
const { parseLayoutLink } = require('./backgroundSlicer');

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
		inputImage.sourceUrl = url;
		inputImage.setStatusMsg('Loading from URL...');
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

	// ?bg=<url> (Backgrounds gallery "Open in Cropper" / "Slice for showcases")
	// and #slice=<base64> (a shared slice-layout link) both point straight at a
	// ready-to-crop background. Either way, land in Background Cropper mode
	// rather than the default Artwork Creator mode.
	const params = new URLSearchParams(window.location.search);
	const layout = parseLayoutLink(window.location.hash);
	const bg = params.get('bg') || (layout && layout.bg);
	if (bg) {
		input.value = bg;
		if (profilePreview.getMode() !== 'cropper') profilePreview.setMode('cropper');
		load();
	}
}

module.exports = setupUrlLoader;
