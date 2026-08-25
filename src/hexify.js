// Steam accepts oversized/tall Featured, Artwork, and Workshop Showcase
// uploads, but won't render them at their real size until the file's
// trailing byte is rewritten to 0x21. Every mainstream image decoder
// tolerates this (pixel data is fully read long before a decoder would reach
// the trailer), but it changes what Steam's own upload-time size sniffing
// sees, so oversized showcase artwork displays as intended instead of being
// silently downscaled. This used to only run on PNG/GIF output; every export
// now goes through it regardless of format.
function hexifyBytes(bytes) {
	let end = bytes.length;
	while (end > 0 && bytes[end - 1] === 0) end--;

	let binary = '';
	for (let i = 0; i < end - 1; i++) binary += String.fromCharCode(bytes[i]);
	binary += '\x21';
	return binary;
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
