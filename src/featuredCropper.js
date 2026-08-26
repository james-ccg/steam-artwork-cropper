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

// Steam's Featured Showcase is a single continuous image, unlike the regular
// Artwork Showcase (which splits into a wide + narrow pair) or the Workshop
// Showcase (five slices) - it just needs to be exactly this wide, at any
// height, so there's no iterative measuring to do here.
const FEATURED_WIDTH = 630;

const featuredShowcase = {
	img: document.getElementById('featuredImg'),
	canvas: null,
	loadImage: function () {
		inputImage.img.onload = function () {
			const img = inputImage.img;
			inputImage.width = img.width;
			inputImage.height = img.height;

			const height = Math.max(1, Math.round((img.height * FEATURED_WIDTH) / img.width));
			featuredShowcase.canvas = new CustomCanvas(FEATURED_WIDTH, height);
			featuredShowcase.canvas.drawImage(
				img,
				0,
				0,
				img.width,
				img.height,
				0,
				0,
				FEATURED_WIDTH,
				height
			);

			featuredShowcase.img.src = featuredShowcase.canvas.toDataURL(
				inputImage.file.type,
				1
			);
			rightPanel.originalSize.innerText = `${img.width} x ${img.height}`;
			document.getElementById('featuredSize').innerText = `${FEATURED_WIDTH} x ${height}`;
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
				await featured_createGif(zip, gifs);
			};
			fileReader.readAsArrayBuffer(inputImage.file);
		} else {
			addRasterToZip(zip);
		}
	},
};

async function addRasterToZip(zip) {
	const canvas = textOverlay.applyToCanvas(featuredShowcase.canvas.canvas);
	const requestedType =
		inputImage.file.type == 'image/apng' ? 'image/png' : inputImage.file.type;
	const blob = await canvasToBlob(
		canvas,
		requestedType,
		requestedType == 'image/png' ? undefined : 1
	);
	const isPng = blob.type == 'image/png';
	const filename = `featured_${inputImage.file.name}`;

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

async function featured_createGif(zip, gifs) {
	const createFrameBuilder = () => {
		let background = new CustomCanvas(gifs[0].dims.width, gifs[0].dims.height);
		background.imageData(gifs[0].patch);

		return function buildFrame(i) {
			let temp = new CustomCanvas(gifs[i].dims.width, gifs[i].dims.height);
			temp.imageData(gifs[i].patch);
			background.addCanvas(temp.canvas, gifs[i].dims.left, gifs[i].dims.top);

			let frame = new CustomCanvas(
				featuredShowcase.canvas.canvas.width,
				featuredShowcase.canvas.canvas.height
			);
			frame.drawImage(
				background.canvas,
				0,
				0,
				background.canvas.width,
				background.canvas.height,
				0,
				0,
				frame.canvas.width,
				frame.canvas.height
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

	const gifName = `featured_${inputImage.file.name}`;
	zip.file(gifName, await hexifyToBase64(blob), { base64: true });
	await finishZip(zip);
}

async function finishZip(zip) {
	inputImage.setStatusMsg('Creating zip file, please wait...');
	zip.generateAsync({ type: 'blob' }).then(function (content) {
		download(content, `${inputImage.file.name}_featured_${new Date().getTime()}.zip`);
		inputImage.setStatusMsg('Done');
	});
}

document
	.getElementById('downloadFeatured')
	.addEventListener('click', featuredShowcase.downloadImage);
document
	.getElementById('featuredTab')
	.addEventListener('click', () =>
		changeTab('featured', () => demoDefaults.loadDefaultFeatured(featuredShowcase.loadImage))
	);

module.exports = featuredShowcase.loadImage;
