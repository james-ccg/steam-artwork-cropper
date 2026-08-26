/* eslint-disable no-undef */
// Animated background slicing (Phase 3). Cuts each showcase-piece rectangle
// out of a .webm / .mp4 / .gif background as its own short clip, using a
// multi-threaded ffmpeg.wasm.
//
// ffmpeg.wasm needs SharedArrayBuffer, which a page only gets when it's
// cross-origin isolated. index.html sets that up with coi-serviceworker
// (COOP + COEP: credentialless). The ~25MB core is loaded from jsDelivr on
// first use only - nothing here is fetched during a normal page load.

const FFMPEG_LIB =
	'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js';
const FFMPEG_CORE =
	'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js';

let ffmpegPromise = null;
let busy = false;

function loadScript(src) {
	return new Promise((resolve, reject) => {
		if (document.querySelector(`script[src="${src}"]`)) return resolve();
		const s = document.createElement('script');
		s.src = src;
		s.crossOrigin = 'anonymous';
		s.onload = () => resolve();
		s.onerror = () => reject(new Error('Could not load ' + src));
		document.head.appendChild(s);
	});
}

function isIsolated() {
	return (
		typeof window !== 'undefined' &&
		window.crossOriginIsolated === true &&
		typeof SharedArrayBuffer !== 'undefined'
	);
}

function ensureFfmpeg(onStatus) {
	if (ffmpegPromise) return ffmpegPromise;
	ffmpegPromise = (async () => {
		if (!isIsolated()) {
			throw new Error(
				'This tab is not cross-origin isolated yet - reload the page and try again.'
			);
		}
		if (onStatus) onStatus('Loading the video engine (~25 MB, first time only)...');
		await loadScript(FFMPEG_LIB);
		if (!window.FFmpeg || !window.FFmpeg.createFFmpeg) {
			throw new Error('The video engine failed to load.');
		}
		const ffmpeg = window.FFmpeg.createFFmpeg({
			corePath: FFMPEG_CORE,
			log: false,
		});
		await ffmpeg.load();
		return ffmpeg;
	})().catch((e) => {
		ffmpegPromise = null;
		throw e;
	});
	return ffmpegPromise;
}

function codecArgs(format, quality) {
	// quality: 0 = "keep it good" defaults, 1..100 = user dial (higher = better)
	switch (format) {
		case 'mp4':
			return [
				'-c:v',
				'libx264',
				'-pix_fmt',
				'yuv420p',
				'-crf',
				quality ? String(Math.round((51 * (100 - quality)) / 100)) : '18',
			];
		case 'webm':
			return [
				'-c:v',
				'libvpx-vp9',
				'-b:v',
				'0',
				'-crf',
				quality ? String(Math.round((63 * (100 - quality)) / 100)) : '30',
				'-row-mt',
				'1',
			];
		case 'webp':
			return [
				'-c:v',
				'libwebp',
				'-lossless',
				'0',
				'-quality',
				quality ? String(quality) : '82',
				'-loop',
				'0',
			];
		case 'apng':
			return ['-f', 'apng', '-plays', '0'];
		default: // gif - palette is added by the caller
			return [];
	}
}

// One clamped crop -> pad, so a rectangle that runs off the edge of the video
// (a narrow background, a long-image piece) is filled with black instead of
// erroring - matching the still slicer's cutRect().
function cropPadFilter(rect, vw, vh) {
	const cx = Math.max(0, rect.sx);
	const cy = Math.max(0, rect.sy);
	const cw = Math.max(1, Math.min(rect.sx + rect.w, vw) - cx);
	const ch = Math.max(1, Math.min(rect.sy + rect.h, vh) - cy);
	const px = cx - rect.sx;
	const py = cy - rect.sy;
	return `crop=${cw}:${ch}:${cx}:${cy},pad=${rect.w}:${rect.h}:${px}:${py}:color=black`;
}

/**
 * @param {object} o
 * @param {File}   o.file       the source .webm/.mp4/.gif
 * @param {number} o.videoW     the width the slices are cut in (= Steam's
 *                              1920px display width for a video); the source
 *                              is scaled to videoW x videoH first
 * @param {number} o.videoH
 * @param {Array}  o.rects      from backgroundSlicer.sliceRects()
 * @param {object} o.opts       { format, fps, quality }
 * @param {(f:number)=>void}      o.onProgress   0..1
 * @param {(s:string)=>void}      o.onStatus
 * @returns {Promise<Array<{file:string, bytes:Uint8Array, type:string}>>}
 */
async function sliceAnimated({ file, videoW, videoH, rects, opts, onProgress, onStatus }) {
	if (busy) throw new Error('Already slicing - wait for the current export to finish.');
	busy = true;
	try {
		const ffmpeg = await ensureFfmpeg(onStatus);
		const { fetchFile } = window.FFmpeg;

		const srcExt = (file.name.split('.').pop() || 'webm').toLowerCase();
		const rawName =
			'raw.' + (['webm', 'mp4', 'gif'].includes(srcExt) ? srcExt : 'webm');
		ffmpeg.FS('writeFile', rawName, await fetchFile(file));

		// Scale to the display size ONCE (lossless-ish VP9), then every piece
		// is a cheap crop of that - much faster than re-scaling per piece.
		let inName = rawName;
		if (rects.length > 1) {
			if (onStatus) onStatus('Preparing the background...');
			inName = 'scaled.webm';
			ffmpeg.setProgress(({ ratio }) => {
				if (onProgress && ratio >= 0 && ratio <= 1) onProgress(ratio * 0.15);
			});
			await ffmpeg.run(
				'-i',
				rawName,
				'-an',
				'-vf',
				`scale=${videoW}:${videoH}`,
				'-c:v',
				'libvpx-vp9',
				'-b:v',
				'0',
				'-crf',
				'12',
				'-row-mt',
				'1',
				inName
			);
			ffmpeg.FS('unlink', rawName);
		}
		const preScaled = inName !== rawName;
		const progBase = preScaled ? 0.15 : 0;

		const fmt = opts.format;
		const mime = {
			mp4: 'video/mp4',
			webm: 'video/webm',
			webp: 'image/webp',
			gif: 'image/gif',
			apng: 'image/apng',
		}[fmt] || 'application/octet-stream';

		const out = [];
		for (let i = 0; i < rects.length; i++) {
			const r = rects[i];
			if (onStatus) onStatus(`Slicing ${r.file} (${i + 1}/${rects.length})...`);
			if (onProgress) onProgress(i / rects.length);

			const outName = `p${i}.${fmt === 'apng' ? 'png' : fmt}`;
			// Steam pins an animated background to 1920px wide; the input is
			// already at that size when pre-scaled, otherwise scale here.
			let vf =
				(preScaled ? '' : `scale=${videoW}:${videoH},`) +
				cropPadFilter(r, videoW, videoH);
			const args = ['-i', inName, '-an'];
			if (opts.fps) args.push('-r', String(opts.fps));

			if (fmt === 'gif') {
				vf +=
					',split[a][b];[a]palettegen=stats_mode=diff' +
					(opts.quality
						? `:max_colors=${Math.max(8, Math.min(256, Math.round((256 * opts.quality) / 100)))}`
						: '') +
					'[p];[b][p]paletteuse=dither=bayer:bayer_scale=3';
				args.push('-filter_complex', vf, '-loop', '0');
			} else {
				args.push('-vf', vf, ...codecArgs(fmt, opts.quality));
			}
			args.push(outName);

			ffmpeg.setProgress(({ ratio }) => {
				if (onProgress && ratio >= 0 && ratio <= 1) {
					onProgress(
						progBase + ((1 - progBase) * (i + ratio)) / rects.length
					);
				}
			});
			await ffmpeg.run(...args);

			const data = ffmpeg.FS('readFile', outName);
			out.push({ file: `${r.file}.${fmt}`, bytes: new Uint8Array(data), type: mime });
			try {
				ffmpeg.FS('unlink', outName);
			} catch (e) {
				/* ignore */
			}
		}
		try {
			ffmpeg.FS('unlink', inName);
		} catch (e) {
			/* ignore */
		}
		if (onProgress) onProgress(1);
		return out;
	} finally {
		busy = false;
	}
}

module.exports = { ensureFfmpeg, sliceAnimated, isIsolated };
