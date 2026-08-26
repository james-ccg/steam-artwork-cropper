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
const { hexifyToBase64 } = require('./hexify');
const uploadGuideText = require('./uploadGuideText');

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

const backgroundShowcase = {
	img: document.getElementById('backgroundImg'),
	canvas: null,
	loadImage: function () {
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

module.exports = backgroundShowcase.loadImage;
