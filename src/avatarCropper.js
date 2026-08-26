const CustomCanvas = require('./CustomCanvas');
const inputImage = require('./inputImage');
const { hexifyToBase64 } = require('./hexify');
const {
	MAX_EXPORT_BYTES,
	canvasToBlob,
	flattenToOpaque,
	compressCanvasToJpegUnderLimit,
	withExtension,
} = require('./exportLimit');

// Steam avatars are a plain square, 184x184 - unlike the showcase formats,
// avatars upload through Steam's normal avatar changer, so the trailing-byte
// hexify trick isn't strictly needed to make them render at full size. It's
// still applied here for consistency (every other file in the zip is
// hexified, and the bundled readme.txt tells people so) and because it's
// harmless - decoders read the pixel data long before the trailer, and
// Steam re-encodes the avatar on upload anyway.
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
		zip.file(withExtension(filename, blob.type), await hexifyToBase64(blob), {
			base64: true,
		});
	} else {
		const source = isPng ? flattenToOpaque(canvas, '#000000') : canvas;
		const jpegBlob = await compressCanvasToJpegUnderLimit(source);
		zip.file(filename.replace(/\.\w+$/, '.jpg'), await hexifyToBase64(jpegBlob), {
			base64: true,
		});
	}
}

module.exports = { addAvatarToZip, buildAvatarCanvas };
