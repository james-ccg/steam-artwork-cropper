// In Background Cropper mode the image the user provides replaces *only* the
// page background of the mock profile, so they can see how their background
// would sit behind a real, populated profile - the avatar, avatar frame,
// showcases and everything else stay exactly as they are and visibly cover
// part of it, which is the whole point of previewing a background. Artwork
// Creator mode leaves the page background alone too; it's about designing
// artwork, not previewing a backdrop.
const inputImage = require('./inputImage');
const tabInfo = require('./tabInfo');
const demoDefaults = require('./demoDefaults');

const ORIGINAL_BACKGROUND = './steam/imgs/james_background.jpg';

let mode = 'creator';

function headerBgEl() {
	return document.querySelector('.has_profile_background.full_width_background');
}

function applyPreview(bgSrc) {
	const bgEl = headerBgEl();
	if (bgEl) bgEl.style.backgroundImage = `url(${bgSrc})`;
}

function restoreOriginal() {
	const bgEl = headerBgEl();
	if (bgEl) bgEl.style.backgroundImage = `url(${ORIGINAL_BACKGROUND})`;
}

// Gated on demoDefaults.hasUserProvidedImage() rather than just inputImage.file
// - the bundled demo image is loaded through that same file/img pipeline (so
// the "before you upload anything" crop preview is a real crop), which would
// otherwise make switching to Background Cropper look like a real upload
// happened before the user ever picked one.
function refresh() {
	if (
		mode === 'cropper' &&
		demoDefaults.hasUserProvidedImage() &&
		inputImage.img &&
		inputImage.img.src
	) {
		applyPreview(inputImage.img.src);
	} else {
		restoreOriginal();
	}
}

// The "Choose format:" toggle lists the three showcases (Featured, Artwork,
// Workshop). The profile Background is not a format - it's the other mode -
// so in Background Cropper mode the whole chooser (label + buttons) is hidden
// and there's nothing to pick. #backgroundTab is a hidden, non-interactive
// element kept only as the hook this clicks programmatically, so routing into
// the background crop area still reuses the same tab/changeTab machinery as
// the other three formats without importing the format modules.
//
// The two nav links are mode toggles: "Background Cropper" routes to the
// background crop area, and (mirroring that) "Artwork Creator" resets to the
// Artwork showcase whenever it's actually switching modes - so leaving
// Background Cropper never strands you on a format you'd picked inside it.
function updateFormatVisibility(switchingModes) {
	const backgroundTab = document.getElementById('backgroundTab');
	if (!backgroundTab) return;
	const formatLabel = document.getElementById('formatToggleLabel');
	const formatRow = document.querySelector('.formatToggleRow');
	if (mode === 'cropper') {
		if (formatLabel) formatLabel.style.setProperty('display', 'none');
		if (formatRow) formatRow.style.setProperty('display', 'none');
		backgroundTab.click();
	} else {
		if (formatLabel) formatLabel.style.removeProperty('display');
		if (formatRow) formatRow.style.removeProperty('display');
		if (switchingModes || tabInfo.currentTab === '#background') {
			const artworkTab = document.getElementById('artworkTab');
			if (artworkTab) artworkTab.click();
		}
	}
}

function setMode(newMode) {
	const changed = newMode !== mode;
	mode = newMode;
	updateFormatVisibility(changed);
	refresh();
}

function getMode() {
	return mode;
}

function setupProfilePreview() {
	// A plain addEventListener (rather than .onload =) so this never clobbers
	// - or gets clobbered by - each format module's own onload handler on the
	// same shared Image object.
	if (inputImage.img) inputImage.img.addEventListener('load', refresh);
}

module.exports = { setMode, getMode, setupProfilePreview };
