/* eslint-disable no-undef */
const JSZip = require('jszip');
const download = require('downloadjs');

const CustomCanvas = require('./CustomCanvas');
const rightPanel = require('./rightPanel');
const changeTab = require('./changeTab');
const inputImage = require('./inputImage');
const textOverlay = require('./textOverlay');
const demoDefaults = require('./demoDefaults');
const {
	MAX_EXPORT_BYTES,
	canvasToBlob,
	flattenToOpaque,
	compressCanvasToJpegUnderLimit,
	withExtension,
} = require('./exportLimit');
const { encodeGifUnderLimit, decodeGifFrames } = require('./gifExport');
const { hexifyToBase64, hexifyBytesToBase64 } = require('./hexify');
const uploadGuideText = require('./uploadGuideText');
const backgroundSlicer = require('./backgroundSlicer');
const animatedSlicer = require('./animatedSlicer');

function isAnimatedSource() {
	const f = inputImage.file;
	return (
		!!f &&
		(f.type === 'image/gif' ||
			f.type === 'video/webm' ||
			f.type === 'video/mp4')
	);
}

const SLICE_README = `These images are slices of one profile background. Uploaded to the
matching showcase, each one fills the space that showcase covers, so the
profile reads as a single seamless picture.

  Background       -> set as your profile background (unchanged)
  Avatar           -> set as your profile avatar
  Artwork_Middle   -> the wide image of an Artwork Showcase (Screenshot is
  Artwork_Side          the same); Side is the narrow right column
  Featured         -> a Featured Artwork Showcase
  Workshop         -> a Workshop Showcase item

Set the Background and Avatar first, then upload the showcase piece(s) with
the console commands in the upload guide:
https://james-ccg.github.io/cropper/faq/#upload-guide

Still pieces are already hexified so they render at full size. Animated
pieces (.webm / .mp4 / .gif) are uploaded as video - no hexify needed.

by xdjames - https://steamcommunity.com/id/james_ccg/
`;

// How Steam actually displays a profile background (profilev2.css):
//   - A STATIC background uses `background-size: auto` on every window
//     <= 1920px wide (`background-position: center top`), i.e. it's shown at
//     its own native size, centered and top-pinned. It is NOT scaled to fit -
//     a narrower image gets black bars at the sides, a wider one is clipped by
//     the window. So there's nothing to "resize" for a correctly-shaped
//     source; this only caps a poster-sized upload so exports stay printable
//     and under Steam's 5MB limit.
//   - An ANIMATED background is a <video> pinned to `width: 1920px` and
//     centered, so an animated source IS effectively displayed at 1920 wide
//     (height proportional). That scaling is applied here.
const ANIMATED_DISPLAY_WIDTH = 1920;
const STATIC_MAX_DIMENSION = 2560;

function computeOutputSize(srcWidth, srcHeight, isAnimated) {
	let w = srcWidth;
	let h = srcHeight;

	if (isAnimated) {
		if (w > ANIMATED_DISPLAY_WIDTH) {
			h = Math.max(1, Math.round((h * ANIMATED_DISPLAY_WIDTH) / w));
			w = ANIMATED_DISPLAY_WIDTH;
		}
		return { width: w, height: h };
	}

	const longest = Math.max(w, h);
	if (longest > STATIC_MAX_DIMENSION) {
		const scale = STATIC_MAX_DIMENSION / longest;
		w = Math.max(1, Math.round(w * scale));
		h = Math.max(1, Math.round(h * scale));
	}
	return { width: w, height: h };
}

// Slicing is what the Background Cropper is for, so it's the default. 'resize'
// is the opt-in "just hexify/downscale the whole background" path.
let bgMode = 'slice';

function sliceOpts() {
	const sc = document.querySelector('input[name="bgShowcase"]:checked');
	const fmt = document.querySelector('input[name="bgSliceFormat"]:checked');
	const a = animatedOpts();
	return {
		showcase: sc && sc.value !== 'none' ? sc.value : null,
		avatar: document.getElementById('bgSliceAvatar').checked,
		format: fmt ? fmt.value : 'png',
		animFormat: a.format,
		animFps: a.fps,
		animQuality: a.quality,
	};
}

function refreshSlicePreview() {
	const container = document.getElementById('bgSlicePreview');
	if (!container) return;
	if (bgMode !== 'slice' || !backgroundShowcase.canvas) {
		container.innerHTML = '';
		return;
	}
	// Slices are cut from the background at its NATIVE resolution (that's what
	// Steam displays and what the piece has to line up against), not the
	// size-capped resize-mode canvas.
	backgroundSlicer.renderPreview(
		container,
		backgroundShowcase.img.src,
		inputImage.width,
		inputImage.height,
		sliceOpts()
	);
}

function nativeSourceCanvas() {
	const src = document.createElement('canvas');
	src.width = inputImage.img.naturalWidth || inputImage.width;
	src.height = inputImage.img.naturalHeight || inputImage.height;
	src.getContext('2d').drawImage(inputImage.img, 0, 0);
	return src;
}

function animatedOpts() {
	const fmt = document.querySelector('input[name="bgAnimFormat"]:checked');
	const fps = parseInt(
		(document.getElementById('bgAnimFps') || {}).value || '0',
		10
	);
	const q = parseInt(
		(document.getElementById('bgAnimQuality') || {}).value || '0',
		10
	);
	return {
		format: fmt ? fmt.value : 'webm',
		fps: fps > 0 ? fps : 0,
		quality: q > 0 ? q : 0,
	};
}

// Show the animated-output controls (format / fps / quality) only when the
// loaded source is actually animated, and surface the one-time
// cross-origin-isolation notice if the tab isn't isolated yet.
function refreshAnimatedControls() {
	const box = document.getElementById('bgAnimControls');
	if (!box) return;
	const animated = isAnimatedSource();
	box.style.display = animated && bgMode === 'slice' ? '' : 'none';

	const notice = document.getElementById('bgAnimIsolationNotice');
	if (notice) {
		notice.style.display =
			animated && bgMode === 'slice' && !animatedSlicer.isIsolated()
				? ''
				: 'none';
	}
}

function setBgMode(mode) {
	bgMode = mode === 'slice' ? 'slice' : 'resize';
	const slicing = bgMode === 'slice';

	const resizeControls = document.getElementById('bgResizeControls');
	const sliceControls = document.getElementById('bgSliceControls');
	const resizePreview = document.getElementById('bgResizePreview');
	const slicePreview = document.getElementById('bgSlicePreview');
	if (resizeControls) resizeControls.style.display = slicing ? 'none' : '';
	if (sliceControls) sliceControls.style.display = slicing ? '' : 'none';
	if (resizePreview) resizePreview.style.display = slicing ? 'none' : '';
	if (slicePreview) slicePreview.style.display = slicing ? '' : 'none';

	const resizeToggle = document.getElementById('bgModeResize');
	if (resizeToggle) resizeToggle.checked = !slicing;

	refreshAnimatedControls();
	refreshSlicePreview();
}

// A .webm / .mp4 background can't load into an <img>. Pull its dimensions and
// first frame off a <video> instead; the first frame stands in for the still
// preview and the slice-rect preview, while the actual animated slicing runs
// ffmpeg over the original file.
function loadVideoBackground(file) {
	inputImage.setStatusMsg('Loading video, please wait...');
	const url = URL.createObjectURL(file);
	const v = document.createElement('video');
	v.muted = true;
	v.playsInline = true;
	v.preload = 'auto';
	v.onerror = function () {
		URL.revokeObjectURL(url);
		inputImage.setStatusMsg("Couldn't read that video.");
	};
	v.onloadeddata = function () {
		// Steam renders an animated background's <video> at a fixed
		// width: 1920px (profilev2.css), so that - not the source's own
		// resolution - is the coordinate space the showcase slices are cut in.
		const dispW = ANIMATED_DISPLAY_WIDTH;
		const dispH = Math.max(
			1,
			Math.round((v.videoHeight * dispW) / v.videoWidth)
		);
		inputImage.width = dispW;
		inputImage.height = dispH;

		const frame = document.createElement('canvas');
		frame.width = dispW;
		frame.height = dispH;
		frame
			.getContext('2d')
			.drawImage(v, 0, 0, v.videoWidth, v.videoHeight, 0, 0, dispW, dispH);

		backgroundShowcase.canvas = new CustomCanvas(dispW, dispH);
		backgroundShowcase.canvas.canvas
			.getContext('2d')
			.drawImage(frame, 0, 0);

		backgroundShowcase.img.src = frame.toDataURL('image/jpeg', 0.85);
		rightPanel.originalSize.innerText = `${v.videoWidth} x ${v.videoHeight}`;
		document.getElementById('backgroundSize').innerText =
			v.videoWidth === dispW
				? `${dispW} x ${dispH} (animated)`
				: `${dispW} x ${dispH} (animated, from ${v.videoWidth} x ${v.videoHeight})`;
		inputImage.setStatusMsg('Done');
		refreshAnimatedControls();
		refreshSlicePreview();
		applyPendingSliceMode();
		URL.revokeObjectURL(url);
	};
	v.src = url;
}

const backgroundShowcase = {
	img: document.getElementById('backgroundImg'),
	canvas: null,
	loadImage: function () {
		if (inputImage.file && inputImage.file.type.indexOf('video/') === 0) {
			loadVideoBackground(inputImage.file);
			return;
		}
		inputImage.img.onload = function () {
			const img = inputImage.img;
			inputImage.width = img.width;
			inputImage.height = img.height;

			const isAnimated =
				!!inputImage.file && inputImage.file.type === 'image/gif';
			const size = computeOutputSize(img.width, img.height, isAnimated);
			backgroundShowcase.canvas = new CustomCanvas(size.width, size.height);
			backgroundShowcase.canvas.drawImage(
				img,
				0,
				0,
				img.width,
				img.height,
				0,
				0,
				size.width,
				size.height
			);

			// Preview straight off the source object URL (which also animates
			// for a GIF) instead of a toDataURL() of the canvas - a PNG or
			// poster-sized background would otherwise become a multi-megabyte
			// data: string shoved into the <img>.
			backgroundShowcase.img.src = img.src;

			rightPanel.originalSize.innerText = `${img.width} x ${img.height}`;
			const resized =
				size.width !== img.width || size.height !== img.height;
			document.getElementById('backgroundSize').innerText = resized
				? `${size.width} x ${size.height} (from ${img.width} x ${img.height})`
				: `${size.width} x ${size.height}`;
			inputImage.setStatusMsg('Done');
			refreshAnimatedControls();
			refreshSlicePreview();
			applyPendingSliceMode();
		};

		if (inputImage.file != null) {
			inputImage.setStatusMsg('Loading image, please wait...');
			inputImage.loadFile();
		}
	},
	downloadImage: function () {
		if (inputImage.file == null) {
			alert('Please select an image first!');
			return;
		}

		if (bgMode === 'slice') {
			exportSlices();
			return;
		}

		inputImage.setStatusMsg('Cropping image, please wait...');

		let zip = new JSZip();
		zip.file('readme.txt', uploadGuideText);

		if (inputImage.file.type == 'image/gif') {
			let fileReader = new FileReader();
			fileReader.onload = async function () {
				let gifs;
				try {
					gifs = decodeGifFrames(fileReader.result);
				} catch (e) {
					inputImage.setStatusMsg(e.message);
					return;
				}
				await background_createGif(zip, gifs);
			};
			fileReader.readAsArrayBuffer(inputImage.file);
		} else {
			addRasterToZip(zip);
		}
	},
};

async function exportSlices() {
	const opts = sliceOpts();
	if (!opts.showcase && !opts.avatar) {
		alert('Pick a showcase (or the avatar) to slice for.');
		return;
	}

	const zip = new JSZip();
	zip.file('readme.txt', SLICE_README);
	const link = backgroundSlicer.layoutLink(inputImage.sourceUrl || '', opts);
	if (link) zip.file('layout.txt', link + '\n');

	try {
		if (isAnimatedSource()) {
			await exportAnimatedSlices(zip, opts);
		} else {
			await exportStillSlices(zip, opts);
		}
	} catch (e) {
		inputImage.setStatusMsg(e && e.message ? e.message : 'Slicing failed.');
		return;
	}

	inputImage.setStatusMsg('Creating zip file, please wait...');
	zip.generateAsync({ type: 'blob' }).then(function (content) {
		download(
			content,
			`${inputImage.file.name}_slices_${new Date().getTime()}.zip`
		);
		inputImage.setStatusMsg('Done');
	});
}

async function exportStillSlices(zip, opts) {
	inputImage.setStatusMsg('Slicing background, please wait...');
	const src = nativeSourceCanvas();
	const pieces = backgroundSlicer.computeSlices(src, opts);

	const sourceType =
		inputImage.file.type === 'image/apng' ? 'image/png' : inputImage.file.type;

	// Bundle the background itself too, so the user uploads a set that lines
	// up - the pieces were cut against exactly these pixels. Always the source
	// format (the format toggle only applies to the showcase pieces).
	inputImage.setStatusMsg('Adding the background...');
	await backgroundSlicer.addPieceToZip(
		zip,
		{ file: 'Background', canvas: src },
		sourceType,
		null
	);

	for (const piece of pieces) {
		inputImage.setStatusMsg(`Slicing ${piece.file}...`);
		// Avatars keep the source format (Steam's avatar upload is normal);
		// only the console-uploaded showcase pieces follow the format toggle.
		const fmt = piece.file === 'Avatar' ? null : opts.format;
		await backgroundSlicer.addPieceToZip(zip, piece, sourceType, fmt);
	}
}

async function exportAnimatedSlices(zip, opts) {
	const aOpts = animatedOpts();
	const rects = backgroundSlicer.sliceRects(
		inputImage.width,
		inputImage.height,
		opts
	);

	// The whole animated background, byte-for-byte, so the uploaded set matches.
	// A GIF gets the trailing-byte nudge; a video container is left alone.
	const bgExt = (inputImage.file.name.split('.').pop() || 'webm').toLowerCase();
	const bgBytes = new Uint8Array(await inputImage.file.arrayBuffer());
	zip.file(
		`Background.${bgExt}`,
		hexifyBytesToBase64(bgBytes, inputImage.file.type),
		{ base64: true }
	);

	const results = await animatedSlicer.sliceAnimated({
		file: inputImage.file,
		videoW: inputImage.width,
		videoH: inputImage.height,
		rects,
		opts: aOpts,
		onStatus: (s) => inputImage.setStatusMsg(s),
		onProgress: (f) =>
			inputImage.setStatusMsg(`Slicing... ${(f * 100).toFixed(0)}%`),
	});

	results.forEach((r) => {
		zip.file(r.file, hexifyBytesToBase64(r.bytes, r.type), { base64: true });
	});
}

async function addRasterToZip(zip) {
	const canvas = textOverlay.applyToCanvas(backgroundShowcase.canvas.canvas);
	const requestedType =
		inputImage.file.type == 'image/apng' ? 'image/png' : inputImage.file.type;
	const blob = await canvasToBlob(
		canvas,
		requestedType,
		requestedType == 'image/png' ? undefined : 1
	);
	const isPng = blob.type == 'image/png';
	const filename = `background_${inputImage.file.name}`;

	if (blob.size <= MAX_EXPORT_BYTES) {
		zip.file(withExtension(filename, blob.type), await hexifyToBase64(blob), {
			base64: true,
		});
	} else {
		inputImage.setStatusMsg(
			`${filename} is over Steam's 5MB limit, compressing...`
		);
		const source = isPng ? flattenToOpaque(canvas, '#000000') : canvas;
		const jpegBlob = await compressCanvasToJpegUnderLimit(source);
		zip.file(
			filename.replace(/\.\w+$/, '.jpg'),
			await hexifyToBase64(jpegBlob),
			{ base64: true }
		);
	}

	await finishZip(zip);
}

async function background_createGif(zip, gifs) {
	// The GIF's logical screen can be larger than any single frame's patch
	// (frames are partial rectangles), so size the compositing canvas to the
	// full extent of every frame rather than assuming frame 0 covers it.
	const canvasW = Math.max(...gifs.map((f) => f.dims.left + f.dims.width));
	const canvasH = Math.max(...gifs.map((f) => f.dims.top + f.dims.height));
	const size = computeOutputSize(canvasW, canvasH, true);

	const createFrameBuilder = () => {
		let background = new CustomCanvas(canvasW, canvasH);

		return function buildFrame(i) {
			let temp = new CustomCanvas(gifs[i].dims.width, gifs[i].dims.height);
			temp.imageData(gifs[i].patch);
			background.addCanvas(temp.canvas, gifs[i].dims.left, gifs[i].dims.top);

			let frame = new CustomCanvas(size.width, size.height);
			frame.drawImage(
				background.canvas,
				0,
				0,
				canvasW,
				canvasH,
				0,
				0,
				size.width,
				size.height
			);

			textOverlay.draw(
				frame.canvasCtx,
				frame.canvas.width,
				frame.canvas.height,
				i / Math.max(1, gifs.length - 1)
			);

			return frame.canvas;
		};
	};

	const blob = await encodeGifUnderLimit({
		frameCount: gifs.length,
		createFrameBuilder,
		frameDelay: (i) =>
			gifs[i].delay || (gifs[1] && gifs[1].delay) || gifs[0].delay || 100,
		transparentColor: '#000000',
		onProgress: (e) =>
			inputImage.setStatusMsg(`Rendering gif - ${(e * 100).toFixed(0)}%`),
	});

	const gifName = `background_${inputImage.file.name}`;
	zip.file(gifName, await hexifyToBase64(blob), { base64: true });
	await finishZip(zip);
}

async function finishZip(zip) {
	inputImage.setStatusMsg('Creating zip file, please wait...');
	zip.generateAsync({ type: 'blob' }).then(function (content) {
		download(content, `${inputImage.file.name}_background_${new Date().getTime()}.zip`);
		inputImage.setStatusMsg('Done');
	});
}

document
	.getElementById('downloadBackground')
	.addEventListener('click', backgroundShowcase.downloadImage);
document
	.getElementById('backgroundTab')
	.addEventListener('click', () =>
		changeTab('background', () => demoDefaults.loadDefaultBackground(backgroundShowcase.loadImage))
	);

const bgModeResize = document.getElementById('bgModeResize');
if (bgModeResize) {
	bgModeResize.addEventListener('change', () =>
		setBgMode(bgModeResize.checked ? 'resize' : 'slice')
	);
}

document
	.querySelectorAll(
		'#bgSliceAvatar, input[name="bgShowcase"], input[name="bgSliceFormat"]'
	)
	.forEach((el) => el.addEventListener('change', refreshSlicePreview));

// One-time "enable animated slicing" - registers the coi service worker and
// reloads so the tab becomes cross-origin isolated. After the reload the
// notice hides itself (isIsolated() is true).
const bgAnimEnable = document.getElementById('bgAnimEnable');
if (bgAnimEnable) {
	bgAnimEnable.addEventListener('click', async () => {
		if (animatedSlicer.isIsolated()) {
			refreshAnimatedControls();
			return;
		}
		bgAnimEnable.disabled = true;
		bgAnimEnable.textContent = 'Enabling...';
		try {
			if (navigator.serviceWorker) {
				await navigator.serviceWorker.register('./coi-serviceworker.min.js');
			}
			window.location.reload();
		} catch (e) {
			bgAnimEnable.disabled = false;
			bgAnimEnable.textContent = 'Enable animated slicing';
			inputImage.setStatusMsg("Couldn't enable animated slicing: " + e.message);
		}
	});
}

// Arriving with `#slice=<base64>` (a shared link) or `?slice=1` (from the
// Backgrounds gallery's "Slice for showcases" button) opens the tool straight
// into Background Cropper + slice mode. A #slice= link also restores the
// showcase choice and format options. The background is fetched by
// urlLoader.js (from the link's `bg` or `?bg=`); once it lands,
// applyPendingSliceMode() flips into slice mode.
let pendingSliceMode = false;

(function restoreFromLink() {
	const params = new URLSearchParams(window.location.search);
	const st = backgroundSlicer.parseLayoutLink(window.location.hash);

	if (params.get('slice') === '1') pendingSliceMode = true;
	if (!st) {
		maybeEnterSliceMode(!!params.get('bg'));
		return;
	}
	pendingSliceMode = true;

	const setChecked = (sel) => {
		const el = document.querySelector(sel);
		if (el) el.checked = true;
	};
	const setVal = (id, val) => {
		const el = document.getElementById(id);
		if (el) el.value = String(val);
	};
	setChecked(`input[name="bgShowcase"][value="${st.showcase || 'none'}"]`);
	const av = document.getElementById('bgSliceAvatar');
	if (av) av.checked = st.avatar;
	setChecked(`input[name="bgSliceFormat"][value="${st.format}"]`);
	if (st.animFormat) {
		setChecked(`input[name="bgAnimFormat"][value="${st.animFormat}"]`);
	}
	if (st.animFps) setVal('bgAnimFps', st.animFps);
	if (st.animQuality) setVal('bgAnimQuality', st.animQuality);

	const bgUrlInput = document.getElementById('bgUrlInput');
	if (st.bg && bgUrlInput && !params.get('bg')) bgUrlInput.value = st.bg;

	maybeEnterSliceMode(!!(st.bg || params.get('bg')));
})();

// When no background is being fetched (a shared link with just a config, or a
// bare ?slice=1), there's nothing to wait for - flip into Background Cropper
// slice mode once every module has finished loading.
function maybeEnterSliceMode(hasBackground) {
	if (!pendingSliceMode || hasBackground) return;
	setTimeout(() => {
		require('./profilePreview').setMode('cropper');
		applyPendingSliceMode();
	}, 0);
}

function applyPendingSliceMode() {
	if (!pendingSliceMode) return;
	pendingSliceMode = false;
	setBgMode('slice');
}

module.exports = backgroundShowcase.loadImage;
