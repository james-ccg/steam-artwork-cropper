const GIF = require('gif.js');
const gifuct = require('gifuct-js');
const { MAX_EXPORT_BYTES } = require('./exportLimit');

// Parses an uploaded GIF's ArrayBuffer into decoded frames. gifuct throws on
// a truncated/corrupt file and can also hand back an empty array for a GIF it
// technically parsed but couldn't decompress - both used to surface as an
// unhandled "cannot read properties of undefined (reading 'dims')" a few
// calls later, leaving the status line stuck on "Cropping...". Callers catch
// the Error this throws and show its message instead.
function decodeGifFrames(arrayBuffer) {
	let frames;
	try {
		frames = gifuct.decompressFrames(gifuct.parseGIF(arrayBuffer), true);
	} catch (e) {
		throw new Error(
			"Couldn't read that GIF - it may be corrupt or use a feature this tool can't decode. Try re-saving it."
		);
	}
	if (!Array.isArray(frames) || frames.length === 0 || !frames[0].dims) {
		throw new Error("Couldn't read any frames from that GIF.");
	}
	return frames;
}

/**
 * Encodes an animated GIF from a sequence of composited frames, automatically
 * dropping frames (evenly, preserving total playback duration) if the encoded
 * file comes out over maxBytes. Frame dimensions are never changed - Steam
 * expects exact showcase sizes, so frame count is the only lever left.
 *
 * GIF frames are delta-encoded, so every source frame still has to be walked
 * in order to keep the composited image correct - "dropping" a frame just
 * means it isn't handed off to the encoder, its delay is carried over to the
 * next frame that is.
 *
 * @param {object} options
 * @param {number} options.frameCount - number of source frames
 * @param {() => (frameIndex: number) => HTMLCanvasElement} options.createFrameBuilder
 *   Factory returning a fresh per-attempt builder (it closes over its own
 *   "background" canvas, which must restart from frame 0 on every attempt).
 * @param {(frameIndex: number) => number} options.frameDelay
 * @param {string|undefined} options.transparentColor - forwarded to gif.js's `transparent` option
 * @param {(fraction: number) => void} [options.onProgress]
 * @param {number} [options.maxBytes]
 * @param {number} [options.maxStride] - hard cap on how many frames can be dropped in a row
 * @returns {Promise<Blob>}
 */
function encodeGifUnderLimit({
	frameCount,
	createFrameBuilder,
	frameDelay,
	transparentColor,
	onProgress,
	maxBytes = MAX_EXPORT_BYTES,
	maxStride = 10,
}) {
	// Building every frame (compositing GIF deltas onto a running canvas, then
	// cropping/resizing into the showcase slice) runs on the main thread and,
	// for a source with hundreds of frames, can take long enough that the tab
	// looks frozen and the browser may offer to kill it - gif.js's own
	// 'progress' event only covers the encoding phase *after* every frame is
	// already built, so it can't report anything during that stretch. Building
	// in small batches with a setTimeout(0) between them yields back to the
	// browser regularly (keeping it responsive) and gives a progress figure
	// that covers the whole attempt, not just the back half of it.
	const FRAME_BATCH_SIZE = 20;
	const attempt = (stride) =>
		new Promise((resolve) => {
			const buildFrame = createFrameBuilder();
			const gifjs = new GIF({
				workers: 2,
				quality: 1,
				workerScript: 'steam/js/gif.worker.js',
				transparent: transparentColor,
			});

			gifjs.on('finished', resolve);
			if (onProgress) gifjs.on('progress', (e) => onProgress(0.5 + e * 0.5));

			let accumulatedDelay = 0;
			let i = 0;
			function buildNextBatch() {
				const batchEnd = Math.min(i + FRAME_BATCH_SIZE, frameCount);
				for (; i < batchEnd; i++) {
					const canvas = buildFrame(i);
					accumulatedDelay += frameDelay(i);
					if (i % stride === 0 || i === frameCount - 1) {
						gifjs.addFrame(canvas, { delay: accumulatedDelay });
						accumulatedDelay = 0;
					}
				}
				if (onProgress) onProgress((i / frameCount) * 0.5);
				if (i < frameCount) setTimeout(buildNextBatch, 0);
				else gifjs.render();
			}
			buildNextBatch();
		});

	return (async () => {
		let stride = 1;
		let blob = await attempt(stride);
		while (blob.size > maxBytes && stride < maxStride) {
			stride += 1;
			blob = await attempt(stride);
		}
		return blob;
	})();
}

module.exports = { encodeGifUnderLimit, decodeGifFrames };
