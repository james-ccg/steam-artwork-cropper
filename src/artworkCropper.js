const gifuct = require('gifuct-js');
const JSZip = require('jszip');
const download = require('downloadjs');

const CustomCanvas = require('./CustomCanvas');
const rightPanel = require('./rightPanel');
const tabInfo = require('./tabInfo');
const changeTab = require('./changeTab');
const inputImage = require('./inputImage');
const { getComputedValueFor } = require('./functionsExport');
const workshopShowcaseLoadImage = require('./workshopCropper');
const {
	MAX_EXPORT_BYTES,
	canvasToBlob,
	flattenToOpaque,
	compressCanvasToJpegUnderLimit,
	withExtension,
} = require('./exportLimit');
const { encodeGifUnderLimit } = require('./gifExport');
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

		// Get measures for the images on the Artwork showcase
		artworkShowcase.steamHeight = Math.floor(
			(inputImage.height * 613) / inputImage.width
		);
		artworkShowcase.steamBigWidth = Math.floor(
			(inputImage.height * 508) / artworkShowcase.steamHeight
		);
		artworkShowcase.steamSmallWidth = Math.floor(
			(inputImage.height * 102) / artworkShowcase.steamHeight
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

			artworkShowcase.bigCanvas.fillSolid(
				artworkShowcase.steamBigWidth,
				inputImage.height
			);
			artworkShowcase.smallCanvas.fillSolid(
				artworkShowcase.steamSmallWidth,
				inputImage.height
			);
			artworkShowcase.bigImg.src = artworkShowcase.bigCanvas.toDataURL();
			artworkShowcase.smallImg.src =
				artworkShowcase.smallCanvas.toDataURL();

			artworkShowcase.bigImg.onload = testSize; // acts like a while loop
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
			'Make sure to follow the guide on how to upload longer images :)'
		);

		if (inputImage.file.type == 'image/gif') {
			let fileReader = new FileReader();
			fileReader.onload = async function () {
				let gifData = gifuct.parseGIF(fileReader.result);
				let gifs = gifuct.decompressFrames(gifData, true);
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
		frameDelay: (i) => (gifs[i].delay ? gifs[i].delay : gifs[1].delay),
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

// Main
// TODO: FIX THIS (nah man)
// Shared by both the file picker and the "paste a URL" loader below, so a
// background loaded from a link is routed exactly like a local upload.
function loadNewFile(file) {
	if (!file) return;
	inputImage.file = file;
	tabInfo.reset();
	if (tabInfo.currentTab == '#artwork') {
		artworkShowcase.loadImage();
		rightPanel.artworkInfo.show();
		tabInfo.artworkLoaded = true;
	} else {
		// #workshop
		workshopShowcaseLoadImage();
		tabInfo.workshopLoaded = true;
	}
}

inputImage.selectedImage.onchange = function () {
	loadNewFile(inputImage.selectedImage.files[0]);
};

setupUrlLoader(loadNewFile);

function testSize() {
	// Get values for the images shown on the Steam Artwork showcase
	// and check if they need to be adjusted
	// let bigImgComputed = Math.round(parseFloat(getComputedStyle(bigImg).height.replace('px', '')));
	// let smallImgComputed = Math.round(parseFloat(getComputedStyle(smallImg).height.replace('px', '')));
	let bigImgComputed = getComputedValueFor(artworkShowcase.bigImg, 'height');
	let smallImgComputed = getComputedValueFor(
		artworkShowcase.smallImg,
		'height'
	);

	// Very narrow/tall source images can push steamBigWidth past the preview
	// image's own CSS max-width (506px). Past that point its rendered height
	// stops tracking steamBigWidth 1:1, so the +/-1px search below can never
	// converge and steamSmallWidth runs away into negative numbers. Bail out
	// with the last sane width instead of handing a negative-size canvas to
	// the rest of the pipeline. The search loop below already calls
	// smallCanvas.setWidth() on every step it takes, but the *last* step
	// before landing here can leave the real <canvas> element's width at 0
	// (or clamped negative-to-0 by the DOM) even though steamSmallWidth is
	// about to be clamped back to 1 - resync the element itself, or anything
	// that later draws *from* it (not just into it, which toBlob() tolerates
	// but drawImage() does not) throws "canvas element with a width of 0".
	if (artworkShowcase.steamSmallWidth < 1 || artworkShowcase.steamBigWidth > 700) {
		artworkShowcase.steamSmallWidth = Math.max(1, artworkShowcase.steamSmallWidth);
		artworkShowcase.smallCanvas.setWidth(artworkShowcase.steamSmallWidth);
		finishArtworkMeasurement();
		return;
	}

	if (bigImgComputed !== smallImgComputed) {
		// Because the left bigger picture is easier to adjust and less janky to work with,
		// we're setting the right smaller image to an acceptable size taller than the big one,
		// then resize the bigger image's width until their rounded heights are the same
		if (bigImgComputed > smallImgComputed) {
			artworkShowcase.steamBigWidth += 1;
			artworkShowcase.steamSmallWidth -= 1;

			artworkShowcase.smallCanvas.setWidth(
				artworkShowcase.steamSmallWidth
			);
			artworkShowcase.smallCanvas.fillSolid(
				artworkShowcase.steamSmallWidth,
				inputImage.height
			);
			artworkShowcase.smallImg.src =
				artworkShowcase.smallCanvas.toDataURL();
		} else {
			artworkShowcase.steamBigWidth -= 1;
		}
		// bigCanvas and smallCanvas are used for measuring the Steam Artwork Showcase
		artworkShowcase.bigCanvas.setWidth(artworkShowcase.steamBigWidth);
		artworkShowcase.bigCanvas.fillSolid(
			artworkShowcase.steamBigWidth,
			inputImage.height
		);
		artworkShowcase.bigImg.src = artworkShowcase.bigCanvas.toDataURL();
	} else {
		finishArtworkMeasurement();
	}
}

function finishArtworkMeasurement() {
	// When it's done testing, display a preview of the original image and show
	// the resolutions for the pictures on the right side
	artworkShowcase.bigImg.onload = null;
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
		// Display two gifs as preview within resized divs
		let frameHeight = getComputedStyle(
			document.getElementById('bigImgA')
		).height;

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
	if (bigImgComputed < rightSizeComputed) {
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
document
	.getElementById('artworkTab')
	.addEventListener('click', () => changeTab(0, artworkShowcase.loadImage));
