const JSZip = require('jszip');
const download = require('downloadjs');

const CustomCanvas = require('./CustomCanvas');
const rightPanel = require('./rightPanel');
const tabInfo = require('./tabInfo');
const changeTab = require('./changeTab');
const inputImage = require('./inputImage');
const { getComputedValueFor } = require('./functionsExport');
const workshopShowcaseLoadImage = require('./workshopCropper');
const featuredShowcaseLoadImage = require('./featuredCropper');
const backgroundShowcaseLoadImage = require('./backgroundCropper');
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
const textOverlay = require('./textOverlay');
const setupUrlLoader = require('./urlLoader');

// Filenames that are still over Steam's 5MB limit after best-effort
// compression, collected across a single downloadImages() run so the final
// status message can warn about them (dropping frames/quality has a floor -
// an extremely dense source can still end up oversized).
let oversizedWarnings = [];
function doneMessage() {
	if (oversizedWarnings.length === 0) return 'Done';
	return `Done - warning: still over Steam's 5MB limit after compression: ${oversizedWarnings.join(
		', '
	)}`;
}

const artworkShowcase = {
	bigImg: document.getElementById('bigImg'), // The left big image of the showcase
	smallImg: document.getElementById('smallImg'), // The right small image of the showcase
	steamHeight: 0, // Height of the image displayed on the Artwork showcase
	steamBigWidth: 0, // Width of the left image displayed on the Artwork showcase
	steamSmallWidth: 0, // Height of the right image displayed on the Artwork showcase
	leftOffset: 0, // Offset for the right small image
	bigBox: document.querySelector('.bigBox'), // Container for resized gif for the left image
	smallBox: document.querySelector('.smallBox'), // Container for resized gif for the right image
	bigBoxGif: document.getElementById('bigBoxGif'), // Display the gif inside the container
	smallBoxGif: document.getElementById('smallBoxGif'), // Display the gif inside the container
	bigCanvas: null, // Used for measuring the left image
	smallCanvas: null, // Used for measuring the right image
	smallTest: 0, // This is used for storing the height of the image with a hole at the bottom
	reset: function () {
		// Reset function for reseting the showcase
		inputImage.setStatusMsg('Measuring, please wait...');
		rightPanel.originalSize.innerText = '-';
		rightPanel.bigSize.innerText = '-';
		rightPanel.smallSize.innerText = '-';
		rightPanel.leftOffset.innerText = '-';
		rightPanel.leftOffset.innerText = '-';
		rightPanel.toggleSmall.checked = false;
		artworkShowcase.bigBox.style.setProperty('display', 'none');
		artworkShowcase.smallBox.style.setProperty('display', 'none');
		artworkShowcase.bigBoxGif.src = '';
		artworkShowcase.smallBoxGif.src = '';
		artworkShowcase.smallTest = inputImage.height;

		// Starting split of the source width: the primary showcase slot is
		// 613px across = 508 big + 3 gap + 102 small. solveArtworkSplit()
		// refines these so the two rendered slices come out the same height.
		artworkShowcase.steamBigWidth = Math.max(
			1,
			Math.floor((inputImage.width * 508) / 613)
		);
		artworkShowcase.steamSmallWidth = Math.max(
			1,
			Math.min(
				inputImage.width - artworkShowcase.steamBigWidth,
				Math.floor((inputImage.width * 102) / 613)
			)
		);

		// Create canvas objects
		artworkShowcase.bigCanvas = new CustomCanvas(
			artworkShowcase.steamBigWidth,
			inputImage.height
		);
		artworkShowcase.smallCanvas = new CustomCanvas(
			artworkShowcase.steamSmallWidth,
			inputImage.height
		);
	},
	loadImage: function () {
		inputImage.img.onload = function () {
			const img = inputImage.img;
			inputImage.width = img.width;
			inputImage.height = img.height;
			artworkShowcase.reset();
			solveArtworkSplit();
			finishArtworkMeasurement();
		};

		if (inputImage.file != null) inputImage.loadFile();
	},
	downloadImages: async function () {
		// Function for zipping and downloading the cropped images
		if (inputImage.file == null) {
			alert('Please select an image first!');
			return;
		}
		inputImage.setStatusMsg('Cropping images, please wait...');
		oversizedWarnings = [];
		let zip = new JSZip();
		zip.file(
			'readme.txt',
			require('./uploadGuideText')
		);

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
				await as_createGifs(
					zip, // Send JSZip object for zipping the gifs
					gifs, // Send the frames used for cropping
					1 // Which gif is cropping (big image or small image)
				);
			};

			fileReader.readAsArrayBuffer(inputImage.file);
		} else {
			await addRasterToZip(
				zip,
				artworkShowcase.bigCanvas.canvas,
				inputImage.file.type,
				`1_${inputImage.file.name}`
			);
			await addRasterToZip(
				zip,
				artworkShowcase.smallCanvas.canvas,
				inputImage.file.type,
				`2_${inputImage.file.name}`
			);

			inputImage.setStatusMsg('Creating zip file, please wait...');
			zip.generateAsync({
				type: 'blob',
			}).then(function (content) {
				download(
					content,
					`${inputImage.file.name}_${new Date().getTime()}.zip`
				);
				inputImage.setStatusMsg(doneMessage());
			});
		}
	},
};

// Crops a raster (non-gif) image onto the zip, staying under Steam's 5MB
// upload cap. The file picker's "Images" filter lets people pick far more
// formats than canvas can actually re-encode (avif, heic, tiff, bmp, ico,
// svg, ...) - canvas silently falls back to PNG for anything it can't
// encode, so the real blob.type (not the uploaded file's type) decides both
// the output extension and whether the PNG transparency patch applies.
// If the result is still over the limit, it's flattened onto black and
// re-encoded as JPEG at decreasing quality until it fits (PNG has no lossy
// "quality" knob).
async function addRasterToZip(zip, canvas, type, filename) {
	canvas = textOverlay.applyToCanvas(canvas);
	const requestedType = type == 'image/apng' ? 'image/png' : type;
	const blob = await canvasToBlob(
		canvas,
		requestedType,
		requestedType == 'image/png' ? undefined : 1
	);
	const isPng = blob.type == 'image/png';

	if (blob.size <= MAX_EXPORT_BYTES) {
		zip.file(withExtension(filename, blob.type), await hexifyToBase64(blob), {
			base64: true,
		});
		return;
	}

	inputImage.setStatusMsg(
		`${filename} is over Steam's 5MB limit, compressing...`
	);
	const source = isPng ? flattenToOpaque(canvas, '#000000') : canvas;
	const jpegBlob = await compressCanvasToJpegUnderLimit(source);
	const jpegName = filename.replace(/\.\w+$/, '.jpg');
	if (jpegBlob.size > MAX_EXPORT_BYTES) oversizedWarnings.push(jpegName);
	zip.file(jpegName, await hexifyToBase64(jpegBlob), { base64: true });
}

async function as_createGifs(zip, gifs, currentGif) {
	// Recursive function for cropping and zipping gifs
	// smallImgHeight is for it not to check everytime if it needs to add hole at the bottom
	const smallImgHeight = rightPanel.toggleSmall.checked
		? artworkShowcase.smallTest
		: inputImage.height;
	const fixTrail = document.getElementById('gifSloppyFix').checked;
	const transparentColor = document.getElementById('gifSloppyTransparent')
		.checked
		? undefined
		: '#000000';

	// GIF frames are delta-encoded onto a running "background" canvas, so a
	// fresh one is needed each time this is (re-)attempted from frame 0.
	const createFrameBuilder = () => {
		let background = new CustomCanvas(
			gifs[0].dims.width,
			gifs[0].dims.height
		);
		background.imageData(gifs[0].patch);

		return function buildFrame(i) {
			if (fixTrail) background.clear();
			let temp = new CustomCanvas(gifs[i].dims.width, gifs[i].dims.height);
			temp.imageData(gifs[i].patch);
			background.addCanvas(temp.canvas, gifs[i].dims.left, gifs[i].dims.top);

			let frame;
			if (currentGif == 1) {
				frame = new CustomCanvas(
					artworkShowcase.steamBigWidth,
					inputImage.height
				);

				frame.clear();
				frame.addCanvas(background.canvas, 0, 0);
			} else {
				// 2
				frame = new CustomCanvas(
					artworkShowcase.steamSmallWidth,
					smallImgHeight
				);

				frame.clear();
				frame.drawImage(
					background.canvas,
					artworkShowcase.leftOffset,
					0,
					artworkShowcase.steamSmallWidth,
					inputImage.height,
					0,
					0,
					artworkShowcase.steamSmallWidth,
					inputImage.height
				);
			}

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
		transparentColor,
		onProgress: (e) =>
			inputImage.setStatusMsg(
				`Rendering gif ${currentGif}/2 - ${(e * 100).toFixed(0)}%`
			),
	});

	const gifName = `${currentGif}_${inputImage.file.name}`;
	if (blob.size > MAX_EXPORT_BYTES) oversizedWarnings.push(gifName);
	zip.file(gifName, await hexifyToBase64(blob), {
		base64: true,
	});

	if (currentGif != 2) {
		as_createGifs(zip, gifs, currentGif + 1);
	} else {
		inputImage.setStatusMsg('Creating zip file, please wait...');
		zip.generateAsync({
			type: 'blob',
		}).then(function (content) {
			download(
				content,
				`${inputImage.file.name}_as_${new Date().getTime()}.zip`
			);
			inputImage.setStatusMsg(doneMessage());
		});
	}
}

// Shared by both the file picker and the "paste a URL" loader below, so a
// background loaded from a link is routed exactly like a local upload -
// whichever showcase tab is active gets (re)measured against the new image.
function loadNewFile(file) {
	demoDefaults.markUserProvidedImage();
	if (!file) return;
	inputImage.file = file;
	tabInfo.reset();

	// A video only makes sense as an animated profile background - route it to
	// the Background Cropper regardless of which tab happens to be open.
	// setMode('cropper') clicks into the background area, and because the demo
	// loader is a no-op once a user file is set, that runs the load for us.
	if (file.type && file.type.indexOf('video/') === 0) {
		require('./profilePreview').setMode('cropper');
		rightPanel.backgroundInfo.show();
		return;
	}

	if (tabInfo.currentTab == '#featured') {
		featuredShowcaseLoadImage();
		rightPanel.featuredInfo.show();
		tabInfo.loaded.featured = true;
	} else if (tabInfo.currentTab == '#workshop') {
		workshopShowcaseLoadImage();
		rightPanel.workshopInfo.show();
		tabInfo.loaded.workshop = true;
	} else if (tabInfo.currentTab == '#background') {
		backgroundShowcaseLoadImage();
		rightPanel.backgroundInfo.show();
		tabInfo.loaded.background = true;
	} else {
		// #artwork
		artworkShowcase.loadImage();
		rightPanel.artworkInfo.show();
		tabInfo.loaded.artwork = true;
	}
}

inputImage.selectedImage.onchange = function () {
	inputImage.sourceUrl = null; // a picked file has no shareable URL
	loadNewFile(inputImage.selectedImage.files[0]);
};

setupUrlLoader(loadNewFile);

// Artwork is the default active tab, so its demo loads immediately; Featured
// and Workshop's demos load lazily the first time each tab is opened (see
// their own click handlers), matching how a real upload is only measured
// once its tab is actually visible.
demoDefaults.loadDefaultArtwork(artworkShowcase.loadImage).then(function () {
	tabInfo.loaded.artwork = true;
});

// Both showcase preview <img>s render at a fixed on-page width regardless of
// their source: the big one is pinned to 506px by its own max-width, the
// small one fills a 100px slot. So each slice's rendered height is just
// sourceHeight * displayWidth / sliceWidth - there's no need to rasterise a
// solid canvas, push it into an <img>, wait for it to decode and then read
// getComputedStyle() back. That async DOM round-trip was the source of two
// separate first-load bugs: a runaway that stretched the page to ~76000px,
// then (after the first fix) a hang when a slice width reached 0 and
// canvas.toDataURL() returned "data:," (which fires onerror, not onload).
const BIG_PREVIEW_WIDTH = 506;
const SMALL_PREVIEW_WIDTH = 100;

function solveArtworkSplit() {
	const W = inputImage.width;
	const H = inputImage.height;

	let bw = artworkShowcase.steamBigWidth;
	let sw = artworkShowcase.steamSmallWidth;

	const bigH = (w) => Math.round((H * BIG_PREVIEW_WIDTH) / Math.max(1, w));
	const smallH = (w) => Math.round((H * SMALL_PREVIEW_WIDTH) / Math.max(1, w));

	// Same +/-1 search the old DOM loop ran, just on the closed-form heights:
	// grow the big slice / shrink the small one whenever the big renders
	// taller, otherwise shrink the big slice, until the two match. Bounded so
	// a source that can't be evenly split (very wide/short) can't spin.
	for (let i = 0; i < 400; i++) {
		const diff = bigH(bw) - smallH(sw);
		if (diff === 0) break;
		if (diff > 0) {
			if (sw <= 1 || bw >= W - 1) break;
			bw += 1;
			sw -= 1;
		} else {
			if (bw <= 1) break;
			bw -= 1;
		}
	}

	// Landed against a rail - fall back to the two slots' display-width ratio
	// so both previews still come out the same height.
	if (sw < 1) {
		sw = Math.round((bw * SMALL_PREVIEW_WIDTH) / BIG_PREVIEW_WIDTH);
	}
	bw = Math.max(1, Math.min(W, bw));
	sw = Math.max(1, Math.min(W - 1, sw));

	artworkShowcase.steamBigWidth = bw;
	artworkShowcase.steamSmallWidth = sw;
	artworkShowcase.bigCanvas.setWidth(bw);
	artworkShowcase.smallCanvas.setWidth(sw);
}

function finishArtworkMeasurement() {
	// When it's done testing, display a preview of the original image and show
	// the resolutions for the pictures on the right side
	artworkShowcase.bigImg.onload = null;
	artworkShowcase.smallImg.onload = null;
	artworkShowcase.leftOffset =
		inputImage.width - artworkShowcase.steamSmallWidth;
	inputImage.setStatusMsg('Done');

	artworkShowcase.bigCanvas.clear();
	artworkShowcase.bigCanvas.drawImage(
		inputImage.img,
		0,
		0,
		artworkShowcase.steamBigWidth,
		inputImage.height,
		0,
		0,
		artworkShowcase.steamBigWidth,
		inputImage.height
	);

	artworkShowcase.smallCanvas.clear();
	artworkShowcase.smallCanvas.drawImage(
		inputImage.img,
		artworkShowcase.leftOffset,
		0,
		artworkShowcase.steamSmallWidth,
		inputImage.height,
		0,
		0,
		artworkShowcase.steamSmallWidth,
		inputImage.height
	);

	if (inputImage.file.type == 'image/gif') {
		artworkShowcase.bigCanvas.clear();
		artworkShowcase.smallCanvas.clear();
	}
	artworkShowcase.bigImg.src = artworkShowcase.bigCanvas.toDataURL(
		inputImage.file.type,
		1
	);
	artworkShowcase.smallImg.src = artworkShowcase.smallCanvas.toDataURL(
		inputImage.file.type,
		1
	);

	rightPanel.originalSize.innerText = `${inputImage.width} x ${inputImage.height}`;
	rightPanel.bigSize.innerText = `${artworkShowcase.steamBigWidth} x ${inputImage.height}`;
	rightPanel.smallSize.innerText = `${artworkShowcase.steamSmallWidth} x ${inputImage.height}`;
	rightPanel.leftOffset.innerText = `${artworkShowcase.leftOffset}`;

	if (inputImage.file.type == 'image/gif') {
		// Display two gifs as preview within resized divs. The big preview
		// renders at a fixed 506px wide, so its on-page height is just the
		// source height scaled by 506 / steamBigWidth - computing it directly
		// avoids reading a getComputedStyle() height back off an <img> whose
		// src was reassigned a couple of lines up and hasn't decoded yet.
		let frameHeight =
			Math.round(
				(inputImage.height * BIG_PREVIEW_WIDTH) /
					artworkShowcase.steamBigWidth
			) + 'px';

		artworkShowcase.smallBoxGif.src = inputImage.img.src;
		artworkShowcase.bigBoxGif.src = inputImage.img.src;
		artworkShowcase.bigBox.style.height = frameHeight;
		artworkShowcase.bigBoxGif.style.height = frameHeight;
		artworkShowcase.smallBoxGif.style.height = frameHeight;
		artworkShowcase.bigBox.style.removeProperty('display');
		artworkShowcase.smallBox.style.removeProperty('display');
	}
}

function rightSide() {
	// This function is used for creating a hole for the '+N' element if the user
	// has more artwork images uploaded on Steam
	let bigImgComputed = getComputedValueFor(artworkShowcase.bigImg, 'height');
	let rightSizeComputed =
		getComputedValueFor(document.getElementById('rightSide'), 'height') -
		12;
	// Floor smallTest at 1: a 0-height canvas gives toDataURL() "data:,",
	// which fires onerror not onload and would stall this reflow loop.
	if (bigImgComputed < rightSizeComputed && artworkShowcase.smallTest > 1) {
		artworkShowcase.smallTest--;
		artworkShowcase.smallCanvas.setHeight(artworkShowcase.smallTest);
		artworkShowcase.smallCanvas.fillSolid(
			artworkShowcase.steamSmallWidth,
			artworkShowcase.smallTest
		);
		artworkShowcase.smallImg.src = artworkShowcase.smallCanvas.toDataURL();
	} else {
		artworkShowcase.smallImg.onload = null;
		inputImage.setStatusMsg('Done');
		rightPanel.smallSize.innerText = `${artworkShowcase.steamSmallWidth} x ${artworkShowcase.smallTest}`;

		artworkShowcase.smallCanvas.clear();
		artworkShowcase.smallCanvas.drawImage(
			inputImage.img,
			artworkShowcase.leftOffset,
			0,
			artworkShowcase.steamSmallWidth,
			inputImage.height,
			0,
			0,
			artworkShowcase.steamSmallWidth,
			inputImage.height
		);

		artworkShowcase.smallImg.src = artworkShowcase.smallCanvas.toDataURL(
			inputImage.file.type,
			1
		);
	}
}

function toggleSmall() {
	// This function is called when the 'Bottom right space' checkbox is clicked
	if (rightPanel.toggleSmall.checked) {
		if (artworkShowcase.smallTest === inputImage.height) {
			artworkShowcase.smallImg.onload = rightSide;

			// Some resolutions can't be approximated right for smaller images,
			// so we give the small ones a bit more height, then manually adjust it
			let m = 50;
			if (artworkShowcase.steamSmallWidth < 100) m = 40;

			// Approximate the correct length, then check it manually
			artworkShowcase.smallTest = Math.round(
				((artworkShowcase.bigImg.height - m) *
					artworkShowcase.steamSmallWidth) /
					102
			);
			inputImage.setStatusMsg('Measuring, please wait...');
			rightSide();
		} else {
			artworkShowcase.smallCanvas.setHeight(artworkShowcase.smallTest);
		}
		rightPanel.smallSize.innerText = `${artworkShowcase.steamSmallWidth} x ${artworkShowcase.smallTest}`;
	} else {
		artworkShowcase.smallCanvas.setHeight(inputImage.height);
		rightPanel.smallSize.innerText = `${artworkShowcase.steamSmallWidth} x ${inputImage.height}`;
	}

	artworkShowcase.smallCanvas.clear();
	artworkShowcase.smallCanvas.drawImage(
		inputImage.img,
		artworkShowcase.leftOffset,
		0,
		artworkShowcase.steamSmallWidth,
		inputImage.height,
		0,
		0,
		artworkShowcase.steamSmallWidth,
		inputImage.height
	);

	artworkShowcase.smallImg.src = artworkShowcase.smallCanvas.toDataURL(
		inputImage.file.type,
		1
	);
}

// Add events to elements on the right panel for Artwork showcase
document.getElementById('toggleSmall').addEventListener('click', toggleSmall);
document
	.getElementById('downloadArtwork')
	.addEventListener('click', artworkShowcase.downloadImages);
document.getElementById('artworkTab').addEventListener('click', () => {
	const wasLoaded = tabInfo.loaded.artwork;
	changeTab('artwork', artworkShowcase.loadImage);
	// changeTab only runs loadImage the first time the tab is shown. If that
	// first run was interrupted (tab switched away before it finished, which
	// hides the preview and zeroes its measured height), the readout is stuck
	// on "-" - re-run it now that the preview is visible again.
	if (wasLoaded && inputImage.file && rightPanel.bigSize.innerText === '-') {
		artworkShowcase.loadImage();
	}
});
