/* eslint-disable no-undef */
const gifuct = require('gifuct-js');
const JSZip = require('jszip');
const download = require('downloadjs');

const CustomCanvas = require('./CustomCanvas');
const rightPanel = require('./rightPanel');
const inputImage = require('./inputImage');
const { getComputedValueFor } = require('./functionsExport');
const changeTab = require('./changeTab');
const {
	MAX_EXPORT_BYTES,
	flattenToOpaque,
	compressCanvasToJpegUnderLimit,
	withExtension,
} = require('./exportLimit');
const { encodeGifUnderLimit } = require('./gifExport');
const { hexifyBytes, hexifyToBase64 } = require('./hexify');
const textOverlay = require('./textOverlay');
const demoDefaults = require('./demoDefaults');
const profilePreview = require('./profilePreview');
const { addAvatarToZip } = require('./avatarCropper');

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

const workshopShowcase = {
	previewBox: $('#preview-box'), // Clipping box around the slice preview area
	dragContainer: $('#drag-container'), // Positioned wrapper the slider is dragged within
	dragElem: $('#drag-elem'), // Selector for the orange slider element
	imgPreview: $('#img-preview'), // The <img> element where the image is shown
	smallImageWarning: $('.warning'), // Warning element if the image is too small for workshop showcase
	steamHeight: 0, // Height of the image displayed on the Workshop showcase
	sliceWidth: 0, // Width of the "Workshop Item"
	gapWitdh: 0, // Width of the gap between the images
	sliderOffset: 0, // Offset from the top of the image to the slider
	sliderHeight: 0, // Actual height of the slider to the image
	resetSlider: function() {
		// Reset slider's height and position
		workshopShowcase.dragElem
			.css({
				top: `${-(workshopShowcase.getImgHeight() - 2)}px`,
				height: '118px'
			})
			.resizable({
				minHeight: 118,
				maxHeight:
					getComputedValueFor(
						document.getElementById('img-preview'),
						'height'
					) - 4,
				handles: 's, n'
			});
	},
	resetImagePreview: function() {
		// Reset the image preview's width and height back to original size.
		// "Disable slider" (crop the whole image) is the default; the slider
		// is there for people who want to hand-pick a slice instead.
		workshopShowcase.previewBox.css('width', '632px');
		workshopShowcase.imgPreview.css('width', '626px');
		$('#toggleSlider').prop('disabled', false).prop('checked', true);
		$('#togglePreview').prop('disabled', true);
		workshopShowcase.dragElem.hide();
		workshopShowcase.fixHeight();
	},
	showOriginalImagePreview: function() {
		// Display a preview of what a small image would look like on the workshop showcase.
		// The image is too small to slice further, so the slider is forced off here.
		let adjustWidth = inputImage.width + 8;
		workshopShowcase.smallImageWarning.show();
		workshopShowcase.previewBox.css('width', `${adjustWidth + 2}px`);
		workshopShowcase.imgPreview.css('width', `${adjustWidth}px`);
		$('#toggleSlider').prop('disabled', true).prop('checked', true);
		$('#togglePreview').prop('disabled', true);
		workshopShowcase.dragElem.hide();
		workshopShowcase.fixHeight();
	},
	fixHeight: function() {
		// Fix to remove the empty space below the preview created by
		// the draggable element and reset it's location back to the top
		workshopShowcase.dragContainer.css(
			'height',
			getComputedStyle(document.getElementById('img-preview')).height
		);
		workshopShowcase.previewBox.css('height', '');
		workshopShowcase.resetSlider();
	},
	getImgHeight: function() {
		return workshopShowcase.imgPreview.height() + 2;
	},
	togglePreview: function() {
		// Toggle a preview of how would the picture look as Workshop Items
		if ($('#togglePreview').is(':checked')) {
			workshopShowcase.dragElem.hide();
			workshopShowcase.previewBox.css(
				'height',
				workshopShowcase.dragElem.css('height')
			);
			workshopShowcase.dragContainer.css(
				'bottom',
				`${workshopShowcase.getImgHeight() +
					parseInt(
						$('#drag-elem')
							.css('top')
							.replace('px', '')
					)}px`
			);
			$('#toggleSlider').prop('disabled', true);
		} else {
			if (!$('#toggleSlider').is(':checked')) {
				workshopShowcase.dragElem.show();
			}

			workshopShowcase.previewBox.css('height', '');
			workshopShowcase.dragContainer.css('bottom', '');
			$('#toggleSlider').prop('disabled', false);
		}
	},
	toggleSlider: function() {
		// Toggle the slider's visibility and disable the 'togglePreview' checkbox
		if (workshopShowcase.dragElem.css('display') == 'none') {
			workshopShowcase.dragElem.css({
				display: ''
			});
			$('#togglePreview').prop('disabled', false);
		} else {
			workshopShowcase.dragElem.css({
				display: 'none'
			});
			$('#togglePreview').prop('disabled', true);
		}
	},
	toggleOriginalImage: function() {
		// Toggle a preview of what the image would look like with it's original size and resized
		if ($('#resizeImage').is(':checked')) {
			workshopShowcase.resetImagePreview();
		} else {
			workshopShowcase.showOriginalImagePreview();
		}
	},
	loadImage: function() {
		inputImage.img.onload = function() {
			const img = inputImage.img;
			inputImage.width = img.width;
			inputImage.height = img.height;
			rightPanel.originalSize.innerText = `${img.width} x ${img.height}`;
			workshopShowcase.toggleSquare = true;
			workshopShowcase.imgPreview.attr('src', img.src);
			workshopShowcase.reset();
			inputImage.setStatusMsg('Done');
		};

		if (inputImage.file != null) {
			inputImage.setStatusMsg('Loading image, please wait...');
			inputImage.loadFile();
		}
	},
	reset: function() {
		workshopShowcase.resetImagePreview();
		workshopShowcase.smallImageWarning.hide();
		workshopShowcase.steamHeight = getComputedValueFor(
			workshopShowcase.imgPreview[0],
			'height'
		);
		// workshopShowcase.sliceWidth = Math.round(
		// 	(122.4 * inputImage.width) / 632
		// );
		workshopShowcase.sliceWidth = Math.round(
			(123 * inputImage.width) / 632
		);
		workshopShowcase.gapWitdh = Math.round(
			(inputImage.width - workshopShowcase.sliceWidth * 5) / 4
		);
		workshopShowcase.previewBox.css('height', '');
		workshopShowcase.dragContainer.css('bottom', '');
		$('#togglePreview').prop('checked', false);

		// if (workshopShowcase.sliceWidth < 122 || inputImage.height < 122) {
		if (workshopShowcase.sliceWidth < 123 || inputImage.height < 123) {
			workshopShowcase.showOriginalImagePreview();
			$('#resizeImage').prop('checked', false);
		} else {
			workshopShowcase.resetImagePreview();
		}
	},
	downloadImages: function() {
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

		document.getElementById('test').innerHTML = '';

		if (!$('#toggleSlider').is(':checked')) {
			// If the slider is enabled
			if ($('#togglePreview').is(':checked')) {
				$('#togglePreview').click();
			}

			workshopShowcase.sliderHeight = Math.round(
				((workshopShowcase.dragElem.height() + 4) * inputImage.width) /
					626
			);
			workshopShowcase.sliderOffset = Math.round(
				(workshopShowcase.dragElem.position().top * inputImage.width) /
					-626
			);
		} else {
			workshopShowcase.sliderOffset = 0;
		}

		if (inputImage.file.type != 'image/gif') {
			let imgHeight = !$('#toggleSlider').is(':checked')
				? workshopShowcase.sliderHeight
				: inputImage.height;
			let cropCanvas;

			if ($('#resizeImage').is(':checked')) {
				// Stretch the slices to fit whole showcase width

				if (!$('#toggleSlider').is(':checked')) {
					cropCanvas = new CustomCanvas(
						123,
						getComputedValueFor(
							workshopShowcase.dragElem[0],
							'height'
						) + 4
					);
				} else {
					cropCanvas = new CustomCanvas(
						123,
						getComputedValueFor(
							workshopShowcase.imgPreview[0],
							'height'
						)
					);
				}
			} else {
				// Keep the image's original size
				cropCanvas = new CustomCanvas(
					workshopShowcase.sliceWidth,
					imgHeight
				);
			}

			ws_cropImages(
				zip, // Send JSZip object for zipping the gifs
				cropCanvas, // Send CustomCanvas object used for cropping
				1, // Which image / slice is cropping, acts like a counter
				$('#resizeImage').is(':checked') // If the image is too small and needs to be resized
			);
		} else {
			let fileReader = new FileReader();
			fileReader.onload = function() {
				let gifData = gifuct.parseGIF(fileReader.result);
				let gifs = gifuct.decompressFrames(gifData, true);
				ws_cropGifs(
					zip, // Send JSZip object for zipping the gifs
					gifs, // Send the frames used for cropping
					1, // Which image / slice is cropping, acts like a counter
					$('#resizeImage').is(':checked') // If the image is too small and needs to be resized
				);
			};

			fileReader.readAsArrayBuffer(inputImage.file);
		}
	}
};

function ws_cropImages(zip, canvasEl, sliceNum, isImageSmall) {
	// Recursive function for cropping images
	let patcher = new FileReader();
	// The file picker's "Images" filter lets people pick far more formats
	// than canvas can actually re-encode (avif, heic, tiff, bmp, ico, svg,
	// ...) - canvas silently falls back to PNG for anything it can't encode,
	// so this (set from the real blob below, once toBlob has resolved) - not
	// the uploaded file's own type - decides the output extension and
	// whether the PNG transparency patch applies.
	let outputType;
	patcher.onload = async function() {
		let buffer = patcher.result;
		let bytes = new Uint8Array(buffer);
		let filename = `${sliceNum}_${inputImage.file.name}`;
		const isPng = outputType == 'image/png';

		if (bytes.length <= MAX_EXPORT_BYTES) {
			zip.file(
				withExtension(filename, outputType),
				window.btoa(hexifyBytes(bytes)),
				{ base64: true }
			);
		} else {
			// Over Steam's 5MB limit - PNG has no lossy "quality" knob, so
			// flatten it onto black first; JPEG can just be re-encoded directly.
			inputImage.setStatusMsg(
				`${filename} is over Steam's 5MB limit, compressing...`
			);
			const source = isPng
				? flattenToOpaque(canvasEl.canvas, '#000000')
				: canvasEl.canvas;
			const jpegBlob = await compressCanvasToJpegUnderLimit(source);
			const jpegName = filename.replace(/\.\w+$/, '.jpg');
			if (jpegBlob.size > MAX_EXPORT_BYTES) oversizedWarnings.push(jpegName);
			zip.file(jpegName, await hexifyToBase64(jpegBlob), { base64: true });
		}

		if (sliceNum != 5) {
			ws_cropImages(zip, canvasEl, sliceNum + 1, isImageSmall);
		} else {
			if (profilePreview.getMode() === 'cropper') await addAvatarToZip(zip);
			inputImage.setStatusMsg('Creating zip file, please wait...');
			zip.generateAsync({
				type: 'blob'
			}).then(function(content) {
				download(
					content,
					`${inputImage.file.name}_ws_${new Date().getTime()}.zip`
				);
				inputImage.setStatusMsg(doneMessage());
			});
		}
	};

	canvasEl.clear();
	if (isImageSmall) {
		let temp = new CustomCanvas(
			workshopShowcase.sliceWidth,
			inputImage.height
		);
		let previewHeight =
			getComputedValueFor(workshopShowcase.imgPreview[0], 'height') + 4;
		temp.addCanvas(
			inputImage.img,
			ws_getSliceOffset(sliceNum),
			workshopShowcase.sliderOffset
		);
		canvasEl.addCanvas(
			temp.canvas,
			0,
			0,
			canvasEl.canvas.width,
			previewHeight
		);
	} else {
		canvasEl.addCanvas(
			inputImage.img,
			ws_getSliceOffset(sliceNum),
			workshopShowcase.sliderOffset
		);
	}

	textOverlay.draw(canvasEl.canvasCtx, canvasEl.canvas.width, canvasEl.canvas.height, 1);

	const requestedType =
		inputImage.file.type == 'image/apng' ? 'image/png' : inputImage.file.type;
	canvasEl.canvas.toBlob(
		function(blob) {
			outputType = blob.type;
			patcher.readAsArrayBuffer(blob);
		},
		requestedType,
		requestedType == 'image/png' ? undefined : 1
	);
}

async function ws_cropGifs(zip, gifs, currentSlice, isImageSmall) {
	// Recursive function for cropping gifs
	const toggleSliderChecked = $('#toggleSlider').is(':checked');
	const fixTrail = document.getElementById('gifSloppyFix2').checked;
	const transparentColor = document.getElementById('gifSloppyTransparent2')
		.checked
		? undefined
		: '#000000';
	// imgHeight is for it to check if the slider is enabled and to set it's height
	const imgHeight = !toggleSliderChecked
		? workshopShowcase.sliderHeight
		: inputImage.height;
	const previewHeight =
		getComputedValueFor(workshopShowcase.imgPreview[0], 'height') + 4;

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
			let nextFrame = new CustomCanvas(
				gifs[i].dims.width,
				gifs[i].dims.height
			);
			nextFrame.imageData(gifs[i].patch);
			background.addCanvas(
				nextFrame.canvas,
				gifs[i].dims.left,
				gifs[i].dims.top
			);

			let frame;
			if (isImageSmall) {
				if (!toggleSliderChecked) {
					frame = new CustomCanvas(
						123,
						getComputedValueFor(
							workshopShowcase.dragElem[0],
							'height'
						) + 4
					);
				} else {
					frame = new CustomCanvas(
						123,
						getComputedValueFor(
							workshopShowcase.imgPreview[0],
							'height'
						)
					);
				}

				let temp = new CustomCanvas(
					workshopShowcase.sliceWidth,
					inputImage.height
				);
				temp.addCanvas(
					background.canvas,
					ws_getSliceOffset(currentSlice),
					workshopShowcase.sliderOffset
				);
				frame.addCanvas(
					temp.canvas,
					0,
					0,
					frame.canvas.width,
					previewHeight
				);
			} else {
				frame = new CustomCanvas(workshopShowcase.sliceWidth, imgHeight);
				frame.addCanvas(
					background.canvas,
					ws_getSliceOffset(currentSlice),
					workshopShowcase.sliderOffset
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
				`Rendering gif ${currentSlice}/5 - ${(e * 100).toFixed(0)}%`
			),
	});

	const gifName = `${currentSlice}_${inputImage.file.name}`;
	if (blob.size > MAX_EXPORT_BYTES) oversizedWarnings.push(gifName);

	let patcher = new FileReader();
	patcher.onload = async function() {
		let bytes = new Uint8Array(patcher.result);

		zip.file(gifName, window.btoa(hexifyBytes(bytes)), {
			base64: true
		});

		if (currentSlice != 5) {
			ws_cropGifs(zip, gifs, currentSlice + 1, isImageSmall);
		} else {
			if (profilePreview.getMode() === 'cropper') await addAvatarToZip(zip);
			inputImage.setStatusMsg('Creating zip file, please wait...');
			zip.generateAsync({
				type: 'blob'
			}).then(function(content) {
				download(
					content,
					`${inputImage.file.name}_ws_${new Date().getTime()}.zip`
				);
				inputImage.setStatusMsg(doneMessage());
			});
		}
	};

	patcher.readAsArrayBuffer(blob);
}

function ws_getSliceOffset(sliceNum) {
	switch (sliceNum) {
		case 1:
			return 0;
		case 2:
			return -(workshopShowcase.sliceWidth + workshopShowcase.gapWitdh);
		case 3:
			return (
				-(workshopShowcase.sliceWidth + workshopShowcase.gapWitdh) * 2
			);
		case 4:
			return (
				-(workshopShowcase.sliceWidth + workshopShowcase.gapWitdh) * 3
			);
		case 5:
			return -(inputImage.width - workshopShowcase.sliceWidth);
		default:
			return 0;
	}
}

// Make the orange area draggable and resizable
workshopShowcase.dragElem.draggable({
	containment: '#drag-container',
	scroll: false,
	axis: 'y'
});

document.getElementById('workshopTab').addEventListener('click', () => {
	workshopShowcase.fixHeight();
	changeTab('workshop', () => demoDefaults.loadDefaultWorkshop(workshopShowcase.loadImage));
});
document
	.getElementById('toggleSlider')
	.addEventListener('click', workshopShowcase.toggleSlider);
document
	.getElementById('togglePreview')
	.addEventListener('click', workshopShowcase.togglePreview);
document
	.getElementById('downloadWorkshop')
	.addEventListener('click', workshopShowcase.downloadImages);
document
	.getElementById('resizeImage')
	.addEventListener('click', workshopShowcase.toggleOriginalImage);
document
	.getElementById('resetSlider')
	.addEventListener('click', workshopShowcase.resetSlider);

module.exports = workshopShowcase.loadImage;
