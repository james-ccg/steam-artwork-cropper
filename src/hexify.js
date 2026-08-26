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

module.exports = { hexifyBytes, hexifyToBase64 };
