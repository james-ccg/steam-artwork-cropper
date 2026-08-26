// In Background Cropper mode, whatever background the user provides stands
// in for James's own background, avatar, and avatar frame across the mock
// profile header (including the hover mini-profile) - so people get a feel
// for how their own background would look on an actual Steam profile, not
// just an isolated crop preview. The frame/nameplate are James's personal
// cosmetics, so they're hidden rather than replaced (Steam's own "no frame"
// default). Artwork Creator mode leaves James's own branding alone, since
// it's about designing artwork onto a background, not previewing one.
const inputImage = require('./inputImage');
const tabInfo = require('./tabInfo');
const demoDefaults = require('./demoDefaults');
const { buildAvatarCanvas } = require('./avatarCropper');

const ORIGINAL_BACKGROUND = './steam/imgs/james_background.jpg';
const ORIGINAL_AVATAR = './steam/imgs/james_avatar.jpg';

let mode = 'creator';

function headerBgEl() {
	return document.querySelector('.has_profile_background.full_width_background');
}

function avatarImgs() {
	return document.querySelectorAll(
		'.playerAvatarAutoSizeInner > img, .playersection_avatar img'
	);
}

function frameEls() {
	return document.querySelectorAll('.profile_avatar_frame, .playersection_avatar_frame');
}

function nameplateEl() {
	return document.querySelector('.miniprofile_nameplatecontainer');
}

function applyPreview(bgSrc, avatarSrc) {
	const bgEl = headerBgEl();
	if (bgEl) bgEl.style.backgroundImage = `url(${bgSrc})`;
	avatarImgs().forEach(function (img) {
		img.src = avatarSrc;
	});
	frameEls().forEach(function (frame) {
		frame.style.setProperty('display', 'none');
	});
	const nameplate = nameplateEl();
	if (nameplate) nameplate.style.setProperty('display', 'none');
}

function restoreOriginal() {
	const bgEl = headerBgEl();
	if (bgEl) bgEl.style.backgroundImage = `url(${ORIGINAL_BACKGROUND})`;
	avatarImgs().forEach(function (img) {
		img.src = ORIGINAL_AVATAR;
	});
	frameEls().forEach(function (frame) {
		frame.style.removeProperty('display');
	});
	const nameplate = nameplateEl();
	if (nameplate) nameplate.style.removeProperty('display');
}

// Gated on demoDefaults.hasUserProvidedImage() rather than just inputImage.file
// - the bundled demo image is loaded through that same file/img pipeline (so
// the "before you upload anything" crop preview is a real crop), which would
// otherwise make switching to Background Cropper look like a real upload
// happened before the user ever picked one.
function refresh() {
	if (mode === 'cropper' && demoDefaults.hasUserProvidedImage() && inputImage.img && inputImage.img.src) {
		// Avatar slots get a square center-crop instead of the raw image, so
		// the preview matches the shape Steam's avatar changer would produce.
		const avatarSrc = buildAvatarCanvas().toDataURL('image/png');
		applyPreview(inputImage.img.src, avatarSrc);
	} else {
		restoreOriginal();
	}
}

// "Choose format:" (Featured/Artwork/Workshop) only means anything in
// Artwork Creator mode - Background Cropper has exactly one output, so the
// whole toggle (and its label) hides in favor of Background Cropper's own
// area further down the page. #backgroundTab itself is never shown - it's
// only clicked programmatically here so switching modes reuses the same
// tab/changeTab machinery as the other three, without needing to import the
// format modules here (which would create a require cycle - they already
// import this module).
function updateFormatVisibility() {
	const backgroundTab = document.getElementById('backgroundTab');
	if (!backgroundTab) return;
	const toggle = document.querySelector('.formatToggle');
	const toggleLabel = document.getElementById('formatToggleLabel');
	if (mode === 'cropper') {
		if (toggle) toggle.style.setProperty('display', 'none');
		if (toggleLabel) toggleLabel.style.setProperty('display', 'none');
		backgroundTab.click();
	} else {
		if (toggle) toggle.style.removeProperty('display');
		if (toggleLabel) toggleLabel.style.removeProperty('display');
		if (tabInfo.currentTab === '#background') {
			const artworkTab = document.getElementById('artworkTab');
			if (artworkTab) artworkTab.click();
		}
	}
}

function setMode(newMode) {
	mode = newMode;
	updateFormatVisibility();
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
