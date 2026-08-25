/* eslint-disable no-undef */
const JSZip = require('jszip');
const download = require('downloadjs');

const CustomCanvas = require('./CustomCanvas');
const rightPanel = require('./rightPanel');
const changeTab = require('./changeTab');
const inputImage = require('./inputImage');
const {
	MAX_EXPORT_BYTES,
	canvasToBlob,
	flattenToOpaque,
	compressCanvasToJpegUnderLimit,
	withExtension,
} = require('./exportLimit');
const demoDefaults = require('./demoDefaults');

// Steam avatars are a plain square, 184x184 - unlike the showcase formats,
// avatars upload through Steam's normal avatar changer, so there's no long-
// image rendering quirk to work around here and no hexify step needed.
const AVATAR_SIZE = 184;

const avatarShowcase = {
	img: document.getElementById('avatarImg'),
	canvas: null,
	loadImage: function () {
		inputImage.img.onload = function () {
			const img = inputImage.img;
			inputImage.width = img.width;
			inputImage.height = img.height;

			// Center-crop to a square before resizing, so a non-square source
			// doesn't get squished.
			const side = Math.min(img.width, img.height);
			const sx = (img.width - side) / 2;
			const sy = (img.height - side) / 2;

			avatarShowcase.canvas = new CustomCanvas(AVATAR_SIZE, AVATAR_SIZE);
			avatarShowcase.canvas.drawImage(
				img,
				sx,
				sy,
				side,
				side,
				0,
				0,
				AVATAR_SIZE,
				AVATAR_SIZE
			);

			avatarShowcase.img.src = avatarShowcase.canvas.toDataURL(
				inputImage.file.type,
				1
			);
			rightPanel.originalSize.innerText = `${img.width} x ${img.height}`;
			document.getElementById('avatarSize').innerText = `${AVATAR_SIZE} x ${AVATAR_SIZE}`;
			inputImage.setStatusMsg('Done');
		};

		if (inputImage.file != null) {
			inputImage.setStatusMsg('Loading image, please wait...');
			inputImage.loadFile();
		}
	},
	downloadImage: async function () {
		if (inputImage.file == null) {
			alert('Please select an image first!');
			return;
		}
		inputImage.setStatusMsg('Cropping image, please wait...');

		let zip = new JSZip();
		const canvas = avatarShowcase.canvas.canvas;
		const requestedType =
			inputImage.file.type == 'image/apng' ? 'image/png' : inputImage.file.type;
		const blob = await canvasToBlob(
			canvas,
			requestedType,
			requestedType == 'image/png' ? undefined : 1
		);
		const isPng = blob.type == 'image/png';
		const filename = `avatar_${inputImage.file.name}`;

		if (blob.size <= MAX_EXPORT_BYTES) {
			zip.file(withExtension(filename, blob.type), blob);
		} else {
			inputImage.setStatusMsg(
				`${filename} is over Steam's 5MB limit, compressing...`
			);
			const source = isPng ? flattenToOpaque(canvas, '#000000') : canvas;
			const jpegBlob = await compressCanvasToJpegUnderLimit(source);
			zip.file(filename.replace(/\.\w+$/, '.jpg'), jpegBlob);
		}

		inputImage.setStatusMsg('Creating zip file, please wait...');
		zip.generateAsync({ type: 'blob' }).then(function (content) {
			download(content, `${inputImage.file.name}_avatar_${new Date().getTime()}.zip`);
			inputImage.setStatusMsg('Done');
		});
	},
};

document
	.getElementById('downloadAvatar')
	.addEventListener('click', avatarShowcase.downloadImage);
document.getElementById('avatarTab').addEventListener('click', () =>
	changeTab('avatar', () => demoDefaults.loadDefaultAvatar(avatarShowcase.loadImage))
);

module.exports = avatarShowcase.loadImage;
