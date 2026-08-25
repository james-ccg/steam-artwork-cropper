const GIF = require('gif.js');
const { MAX_EXPORT_BYTES } = require('./exportLimit');

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
			if (onProgress) gifjs.on('progress', onProgress);

			let accumulatedDelay = 0;
			for (let i = 0; i < frameCount; i++) {
				const canvas = buildFrame(i);
				accumulatedDelay += frameDelay(i);
				if (i % stride === 0 || i === frameCount - 1) {
					gifjs.addFrame(canvas, { delay: accumulatedDelay });
					accumulatedDelay = 0;
				}
			}

			gifjs.render();
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

module.exports = { encodeGifUnderLimit };
