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

// Steam profile backgrounds are shown behind the page at their native size,
// pinned to center/top (see profilev2.css's `background-position: center
// top` and the `background-size: auto` breakpoint on .has_profile_background)
// - Steam doesn't force-crop them to any particular height, it just displays
// however tall the upload is. 1920px is the documented max native width
// though, so a wider upload gets scaled down to that (preserving its full
// height, proportionally) instead of losing content off the sides or bottom
// the way a fixed-aspect crop would. Anything already 1920px or narrower is
// left completely alone.
const BACKGROUND_MAX_WIDTH = 1920;

function computeOutputSize(imgWidth, imgHeight) {
	if (imgWidth <= BACKGROUND_MAX_WIDTH) return { width: imgWidth, height: imgHeight };
	const scale = BACKGROUND_MAX_WIDTH / imgWidth;
	return { width: BACKGROUND_MAX_WIDTH, height: Math.max(1, Math.round(imgHeight * scale)) };
}

const backgroundShowcase = {
	img: document.getElementById('backgroundImg'),
	canvas: null,
	loadImage: function () {
		inputImage.img.onload = function () {
			const img = inputImage.img;
			inputImage.width = img.width;
			inputImage.height = img.height;

			const size = computeOutputSize(img.width, img.height);
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

			backgroundShowcase.img.src = backgroundShowcase.canvas.toDataURL(
				inputImage.file.type,
				1
			);
			rightPanel.originalSize.innerText = `${img.width} x ${img.height}`;
			document.getElementById('backgroundSize').innerText = `${size.width} x ${size.height}`;
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
	const size = computeOutputSize(gifs[0].dims.width, gifs[0].dims.height);

	const createFrameBuilder = () => {
		let background = new CustomCanvas(gifs[0].dims.width, gifs[0].dims.height);
		background.imageData(gifs[0].patch);

		return function buildFrame(i) {
			let temp = new CustomCanvas(gifs[i].dims.width, gifs[i].dims.height);
			temp.imageData(gifs[i].patch);
			background.addCanvas(temp.canvas, gifs[i].dims.left, gifs[i].dims.top);

			let frame = new CustomCanvas(size.width, size.height);
			frame.drawImage(
				background.canvas,
				0,
				0,
				background.canvas.width,
				background.canvas.height,
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
