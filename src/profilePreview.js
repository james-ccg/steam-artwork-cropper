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

const ORIGINAL_BACKGROUND = './steam/imgs/dl2_background.jpg';

let mode = 'creator';

function headerBgEl() {
	return document.querySelector('.no_header.profile_page.has_profile_background');
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
// Everything that belongs to Artwork Creator only. The text/border overlay
// panel and the Artwork resolution readouts used to stay on screen in
// Background Cropper mode, so that mode showed the other mode's toolbox (still
// captioned "Artwork Creator") above its own controls. Background Cropper
// carries its own size line inside #backgroundInfo, so these hide outright.
const CREATOR_ONLY = ['formatToggleLabel', 'textOverlayPanel', 'resolutionsBlock'];

// Zoom belongs to the Background Cropper. It sizes the whole mock, which is
// what makes a background readable - a profile with a background, an avatar
// and a showcase is well over a screen tall - but it is the background job
// that needs to see all of that at once, so the control only appears in that
// mode.
const CROPPER_ONLY_SELECTORS = ['.zoomToggleRow'];

// Leaving the mode puts the page back to 100%. Hiding the control while the
// page stayed at half size would leave no way back to full size from Artwork
// Creator, which is a trap rather than a setting. Done by clicking the 100%
// button rather than reaching into the other module, so the zoom has exactly
// one code path and one source of truth for which step is live.
function resetZoom() {
	const btn = document.querySelector('.bgZoomBtn[data-zoom="100"]');
	if (btn && !btn.classList.contains('active')) btn.click();
}

function updateFormatVisibility(switchingModes) {
	const backgroundTab = document.getElementById('backgroundTab');
	if (!backgroundTab) return;
	const formatRow = document.querySelector('.formatToggleRow');
	const creatorOnly = CREATOR_ONLY.map((id) => document.getElementById(id));
	if (formatRow) creatorOnly.push(formatRow);
	const cropperOnly = CROPPER_ONLY_SELECTORS.map((s) =>
		document.querySelector(s)
	);

	if (mode === 'cropper') {
		creatorOnly.forEach((el) => el && el.style.setProperty('display', 'none'));
		cropperOnly.forEach((el) => el && el.style.removeProperty('display'));
		backgroundTab.click();
	} else {
		// Zoom first: resetting it refreshes the slice preview, and the avatar
		// has to be handed back after that, not before.
		resetZoom();
		// The slice preview borrows the profile's own avatar to show the
		// avatar piece in place; leaving Background Cropper hands it back.
		require('./backgroundSlicer').resetAvatar();
		creatorOnly.forEach((el) => el && el.style.removeProperty('display'));
		cropperOnly.forEach((el) => el && el.style.setProperty('display', 'none'));
		if (switchingModes || tabInfo.currentTab === '#background') {
			const artworkTab = document.getElementById('artworkTab');
			if (artworkTab) artworkTab.click();
		}
	}
}

function setMode(newMode) {
	const changed = newMode !== mode;
	mode = newMode;
	// The mode toggle is a segmented control now, so it has to show which half
	// is live the way the format buttons do.
	const creatorBtn = document.getElementById('artworkCreatorNav');
	const cropperBtn = document.getElementById('backgroundCropperNav');
	if (creatorBtn) creatorBtn.classList.toggle('active', mode === 'creator');
	if (cropperBtn) cropperBtn.classList.toggle('active', mode === 'cropper');
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
