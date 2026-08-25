// Steam rejects showcase image uploads over 5MB. Cropped slices are almost
// always small, but a very large/high-detail source image can still push a
// slice over that limit, so every raster export is capped here.
const MAX_EXPORT_BYTES = 5 * 1024 * 1024;

function canvasToBlob(canvas, type, quality) {
	return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// canvas.toBlob/toDataURL can only ever actually produce PNG, JPEG, or WebP
// bytes - if the browser is asked for a type it can't encode (avif, heic,
// tiff, bmp, ico, svg, ...) it silently falls back to PNG instead. The file
// picker's "Images" filter accepts all of those as *input*, so the export
// filename's extension must follow the real, resulting blob.type rather than
// the type of the file the user originally picked - otherwise a browser-side
// fallback quietly hands out a PNG wearing an ".avif" (or similar) name.
function extensionForMimeType(mimeType) {
	switch (mimeType) {
		case 'image/png':
			return 'png';
		case 'image/webp':
			return 'webp';
		case 'image/jpeg':
			return 'jpg';
		default:
			return 'jpg';
	}
}

function withExtension(filename, mimeType) {
	return filename.replace(/\.\w+$/, `.${extensionForMimeType(mimeType)}`);
}

// PNG has no lossy "quality" knob in canvas, so shrinking an oversized PNG
// means giving up transparency: flatten it onto a solid background first,
// then re-encode as JPEG (which does have a quality knob) to fit the limit.
function flattenToOpaque(canvas, bgColor) {
	const flat = document.createElement('canvas');
	flat.width = canvas.width;
	flat.height = canvas.height;
	const ctx = flat.getContext('2d');
	ctx.fillStyle = bgColor;
	ctx.fillRect(0, 0, flat.width, flat.height);
	ctx.drawImage(canvas, 0, 0);
	return flat;
}

// Re-encodes a canvas as JPEG, stepping quality down until it fits under
// maxBytes (or we hit a quality floor where further steps aren't worth it).
async function compressCanvasToJpegUnderLimit(canvas, maxBytes = MAX_EXPORT_BYTES) {
	let quality = 0.9;
	let blob = await canvasToBlob(canvas, 'image/jpeg', quality);
	while (blob.size > maxBytes && quality > 0.15) {
		quality = Math.max(0.15, quality - 0.15);
		blob = await canvasToBlob(canvas, 'image/jpeg', quality);
	}
	return blob;
}

module.exports = {
	MAX_EXPORT_BYTES,
	canvasToBlob,
	flattenToOpaque,
	compressCanvasToJpegUnderLimit,
	withExtension,
};
