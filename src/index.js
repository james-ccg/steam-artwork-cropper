require('webpack-jquery-ui/css');
require('webpack-jquery-ui/draggable');
require('webpack-jquery-ui/resizable');
require('webpack-jquery-ui/sortable');
require('./artworkCropper');
require('./workshopCropper');

const setupDragAndDrop = require('./dragDrop');
setupDragAndDrop('#selectedImage');

const setupDeviceGate = require('./deviceGate');
setupDeviceGate();

const setupMiniProfileHover = require('./miniProfileHover');
setupMiniProfileHover('#avatarHoverTarget', '#miniProfilePopup');

const { setupTextOverlayControls } = require('./textOverlay');
setupTextOverlayControls();

const setupExportButton = require('./exportButton');
setupExportButton();

const profilePreview = require('./profilePreview');
profilePreview.setupProfilePreview();
const artworkCreatorNav = document.getElementById('artworkCreatorNav');
const backgroundCropperNav = document.getElementById('backgroundCropperNav');
// Both nav links are still real <a href="#..."> anchors so they degrade
// sensibly without JS, but the mode switch itself never needs to scroll
// anywhere - prevent the browser's default anchor-jump and stay put at the
// top of the page instead of landing wherever that anchor happens to sit.
function switchMode(event, newMode) {
	event.preventDefault();
	profilePreview.setMode(newMode);
	window.scrollTo({ top: 0 });
}
if (artworkCreatorNav) {
	artworkCreatorNav.addEventListener('click', (event) => switchMode(event, 'creator'));
}
if (backgroundCropperNav) {
	backgroundCropperNav.addEventListener('click', (event) => switchMode(event, 'cropper'));
}
