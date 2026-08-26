const CustomCanvas = require('./CustomCanvas');
const inputImage = require('./inputImage');
const {
	MAX_EXPORT_BYTES,
	canvasToBlob,
	flattenToOpaque,
	compressCanvasToJpegUnderLimit,
	withExtension,
} = require('./exportLimit');

// Steam avatars are a plain square, 184x184 - unlike the showcase formats,
// avatars upload through Steam's normal avatar changer, so there's no long-
// image rendering quirk to work around here and no hexify step needed.
//
// Avatar isn't its own pickable format (Background Cropper bundles it into
// every export automatically instead; Artwork Creator doesn't produce it at
// all) - this module is just the crop routine both call into.
const AVATAR_SIZE = 184;

// Center-crops the currently loaded image to a square before resizing, so a
// non-square source doesn't get squished. Built fresh from inputImage.img
// each time, since there's no dedicated Avatar tab to have pre-built it.
function buildAvatarCanvas() {
	const img = inputImage.img;
	const side = Math.min(img.width, img.height);
	const sx = (img.width - side) / 2;
	const sy = (img.height - side) / 2;

	const canvas = new CustomCanvas(AVATAR_SIZE, AVATAR_SIZE);
	canvas.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
	return canvas;
}

// Adds an avatar-cropped file to an in-progress zip.
async function addAvatarToZip(zip) {
	if (!inputImage.img || !inputImage.width || !inputImage.file) return;

	const canvas = buildAvatarCanvas().canvas;
	const requestedType =
		inputImage.file.type == 'image/apng' ? 'image/png' : inputImage.file.type;
	const blob = await canvasToBlob(
		canvas,
		requestedType,
		requestedType == 'image/png' ? undefined : 1
	);
	const isPng = blob.type == 'image/png';
	const filename = `avatar_${inputImage.file.name}`;

	if (blob.size <= MAX_EXPORT_BYTES) {
		zip.file(withExtension(filename, blob.type), blob);
	} else {
		const source = isPng ? flattenToOpaque(canvas, '#000000') : canvas;
		const jpegBlob = await compressCanvasToJpegUnderLimit(source);
		zip.file(filename.replace(/\.\w+$/, '.jpg'), jpegBlob);
	}
}

module.exports = { addAvatarToZip, buildAvatarCanvas };
