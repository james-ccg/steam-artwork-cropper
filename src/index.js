require('webpack-jquery-ui/css');
require('webpack-jquery-ui/draggable');
require('webpack-jquery-ui/resizable');
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
