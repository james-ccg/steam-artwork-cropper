const tabInfo = require('./tabInfo');
const inputImage = require('./inputImage');

// One "Export" button next to the format toggle, instead of hunting down
// whichever format-specific download button is currently visible further
// down the right panel - it just clicks through to that button, so it
// reuses each format's already-wired, already-tested download logic as-is.
const DOWNLOAD_BUTTON_IDS = {
	featured: 'downloadFeatured',
	artwork: 'downloadArtwork',
	workshop: 'downloadWorkshop',
	background: 'downloadBackground',
};

function setupExportButton() {
	const exportBtn = document.getElementById('exportBtn');
	if (!exportBtn) return;

	exportBtn.addEventListener('click', function () {
		// The bundled demo image is loaded through the same file pipeline as a
		// real upload (so the first-load preview is a real crop), which leaves
		// inputImage.file set before the user has picked anything - the
		// per-format download handlers only null-check that, so without this
		// guard an immediate Export click would hand back a zip of the demo.
		if (!inputImage.userProvidedImage) {
			alert('Select an image or paste an image link first.');
			return;
		}
		const current = tabInfo.currentTab.replace('#', '');
		const targetBtn = document.getElementById(DOWNLOAD_BUTTON_IDS[current]);
		if (targetBtn) targetBtn.click();
	});
}

module.exports = setupExportButton;
