// Steam accepts oversized/tall Featured, Artwork, and Workshop Showcase
// uploads, but won't render them at their real size until the file's
// trailing byte is rewritten to 0x21. Every mainstream image decoder
// tolerates this (pixel data is fully read long before a decoder would reach
// the trailer), but it changes what Steam's own upload-time size sniffing
// sees, so oversized showcase artwork displays as intended instead of being
// silently downscaled. This used to only run on PNG/GIF output; every export
// now goes through it regardless of format.
// Converts bytes to a binary string in fixed-size chunks via the native bulk
// String.fromCharCode(...chunk) instead of one function call (and one string
// concatenation) per byte - for a large export (an animated Workshop GIF
// slice can run tens of megabytes) the old per-byte loop was the actual
// bottleneck, not the image/GIF encoding itself. 0x8000 stays comfortably
// under every engine's argument-count limit for Function.apply.
const CHUNK_SIZE = 0x8000;
function bytesToBinaryString(bytes) {
	let result = '';
	for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
		result += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE));
	}
	return result;
}

function hexifyBytes(bytes) {
	let end = bytes.length;
	while (end > 0 && bytes[end - 1] === 0) end--;

	return bytesToBinaryString(bytes.subarray(0, Math.max(0, end - 1))) + '\x21';
}

function hexifyToBase64(blob) {
	return new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = () =>
			resolve(window.btoa(hexifyBytes(new Uint8Array(reader.result))));
		reader.readAsArrayBuffer(blob);
	});
}

// Format-aware variant used by the background slicer. The generic hexifyBytes
// above (strip trailing zeros, drop the last byte, append 0x21) works, but a
// per-format nudge keeps the file cleaner for each container - this mirrors
// what steamartworkhub.com's cropper does, which is proven against the same
// showcase-upload path:
//   - GIF : final byte -> 0x21 (GIF trailer is a single 0x3B)
//   - JPEG: final byte -> 0xDA, turning the FF D9 EOI into FF DA
//   - PNG : rewrite the IEND CRC + append 0xE1 so Steam's resizer bails but
//           every browser still ignores the trailing bytes after IEND
//   - WebP: bump the RIFF chunk-size field when an ANMF (animation) chunk is
//           present
const FORMAT_FROM_MIME = {
	'image/png': 'png',
	'image/apng': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'video/mp4': 'mp4',
	'video/webm': 'webm',
};

function hexifyByType(bytes, format) {
	let data = bytes;
	const size = data.length;
	if (size === 0) return data;

	switch (format) {
		case 'mp4':
		case 'webm':
			// Video containers are structurally strict and Steam serves them
			// as-is (no display-time resize on an animated showcase), so leave
			// the bytes alone rather than corrupt the container.
			return data;
		case 'gif':
			data[size - 1] = 0x21;
			return data;
		case 'jpg':
		case 'jpeg':
			data[size - 1] = 0xda;
			return data;
		case 'png': {
			if (data[size - 1] === 0xe1) return data;
			const grown = new Uint8Array(size + 1);
			grown.set(data);
			grown.set(
				[0x01, 0x49, 0x45, 0x4e, 0x44, 0x00, 0xd1, 0x1a, 0x4f, 0xe1],
				size - 9
			);
			return grown;
		}
		case 'webp': {
			if (
				size > 0x34 &&
				data[0x2c] === 0x41 &&
				data[0x2d] === 0x4e &&
				data[0x2e] === 0x4d &&
				data[0x2f] === 0x46
			) {
				const v =
					((data[0x30] |
						(data[0x31] << 8) |
						(data[0x32] << 16) |
						(data[0x33] << 24)) >>>
						0) + 1;
				data[0x30] = v & 0xff;
				data[0x31] = (v >> 8) & 0xff;
				data[0x32] = (v >> 16) & 0xff;
				data[0x33] = (v >> 24) & 0xff;
			}
			return data;
		}
		default:
			return hexifyGeneric(data);
	}
}

function hexifyGeneric(bytes) {
	let end = bytes.length;
	while (end > 0 && bytes[end - 1] === 0) end--;
	const out = new Uint8Array(Math.max(0, end - 1) + 1);
	out.set(bytes.subarray(0, Math.max(0, end - 1)));
	out[out.length - 1] = 0x21;
	return out;
}

function hexifyBlobByType(blob) {
	const format = FORMAT_FROM_MIME[blob.type] || null;
	return new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = () => {
			const bytes = new Uint8Array(reader.result);
			const hexed = format ? hexifyByType(bytes, format) : hexifyGeneric(bytes);
			resolve(window.btoa(bytesToBinaryString(hexed)));
		};
		reader.readAsArrayBuffer(blob);
	});
}

// For the animated slicer, which hands back raw bytes + a mime type.
function hexifyBytesToBase64(bytes, mime) {
	const format = FORMAT_FROM_MIME[mime] || null;
	const hexed = format ? hexifyByType(bytes, format) : hexifyGeneric(bytes);
	return window.btoa(bytesToBinaryString(hexed));
}

module.exports = {
	hexifyBytes,
	hexifyToBase64,
	hexifyByType,
	hexifyBlobByType,
	hexifyBytesToBase64,
};
