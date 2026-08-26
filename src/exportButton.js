const tabInfo = require('./tabInfo');

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
		const current = tabInfo.currentTab.replace('#', '');
		const targetBtn = document.getElementById(DOWNLOAD_BUTTON_IDS[current]);
		if (targetBtn) targetBtn.click();
	});
}

module.exports = setupExportButton;
