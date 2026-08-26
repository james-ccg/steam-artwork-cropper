/* eslint-disable no-undef */
// Background Slicer - "Slice for showcases" sub-mode of the Background Cropper.
//
// Steam has no real upload flow for putting a background *behind* a showcase,
// so the trick every background-slicing tool uses (steam.design, Steam
// Artwork Hub, ...) is: cut the exact rectangle of the background that a
// showcase will end up covering, upload that rectangle *as* the showcase's
// image, and the showcase then reads as an uncut continuation of the
// background - the profile looks like one seamless picture.
//
// Geometry is steam.design's published crop config. x offsets are relative
// to the background's horizontal centre (n = floor(bgWidth / 2)); y is from
// the top of the background. The widths are the exact on-profile rendered
// slot widths, so each piece sits 1:1 over the background pixels it was taken
// from.
const CustomCanvas = require('./CustomCanvas');
const {
	MAX_EXPORT_BYTES,
	canvasToBlob,
	flattenToOpaque,
	compressCanvasToJpegUnderLimit,
	withExtension,
} = require('./exportLimit');
const { hexifyBlobByType } = require('./hexify');

const CENTRE_TO_ARTWORK_LEFT = -467; // Artwork / Featured showcase left edge
const CENTRE_TO_SIDE_LEFT = 48; // narrow right column (-467 + 506 + 9px gutter)
const CENTRE_TO_AVATAR_LEFT = -461;
const SHOWCASE_TOP = 256;
const AVATAR_TOP = 36;

const ARTWORK_PRIMARY_W = 506;
const ARTWORK_SIDE_W = 100;
const FEATURED_W = 630;
const AVATAR_SIZE = 164;

// A "long image" piece is cut this tall so the showcase can be dragged to any
// height after upload; only the top (bgHeight - SHOWCASE_TOP) of it lines up
// with the background, the rest is black.
const LONG_IMAGE_HEIGHT = 2000;

const PIECE_GROUPS = {
	avatar: [
		{
			key: 'avatar',
			file: 'Avatar',
			label: 'Avatar',
			dx: CENTRE_TO_AVATAR_LEFT,
			dy: AVATAR_TOP,
			w: AVATAR_SIZE,
			fixedH: AVATAR_SIZE,
		},
	],
	featured: [
		{
			key: 'featured',
			file: 'Featured',
			label: 'Featured Showcase',
			dx: CENTRE_TO_ARTWORK_LEFT,
			dy: SHOWCASE_TOP,
			w: FEATURED_W,
		},
	],
	artwork: [
		{
			key: 'artwork_middle',
			file: 'Artwork_Middle',
			label: 'Artwork Showcase - primary',
			dx: CENTRE_TO_ARTWORK_LEFT,
			dy: SHOWCASE_TOP,
			w: ARTWORK_PRIMARY_W,
		},
		{
			key: 'artwork_side',
			file: 'Artwork_Side',
			label: 'Artwork Showcase - right column',
			dx: CENTRE_TO_SIDE_LEFT,
			dy: SHOWCASE_TOP,
			w: ARTWORK_SIDE_W,
		},
	],
};

// Deepest-on-the-page first, so the ZIP lists avatar, then featured, then the
// artwork pair - the order people upload them in.
const GROUP_ORDER = ['avatar', 'featured', 'artwork'];

function pieceHeight(piece, bgHeight, longImages) {
	if (piece.fixedH) return piece.fixedH;
	if (longImages) return LONG_IMAGE_HEIGHT;
	return Math.max(1, bgHeight - piece.dy);
}

// Cut one piece from the background canvas. The source rectangle can fall
// partly (or wholly) outside the background - a narrow background, or a
// long-image piece taller than the source - so the piece canvas starts black
// and only the covered region is copied in.
function cutPiece(bgCanvas, centre, piece, height) {
	const sx = centre + piece.dx;
	const sy = piece.dy;

	const out = new CustomCanvas(piece.w, height);
	out.fillSolid(piece.w, height);

	const cx = Math.max(0, sx);
	const cy = Math.max(0, sy);
	const cw = Math.min(bgCanvas.width, sx + piece.w) - cx;
	const ch = Math.min(bgCanvas.height, sy + height) - cy;
	if (cw > 0 && ch > 0) {
		out.drawImage(bgCanvas, cx, cy, cw, ch, cx - sx, cy - sy, cw, ch);
	}
	return out;
}

/**
 * @param {HTMLCanvasElement} bgCanvas  the (already size-normalised) background
 * @param {{artwork:boolean, featured:boolean, avatar:boolean, longImages:boolean}} opts
 * @returns {Array<{key:string, file:string, label:string, canvas:HTMLCanvasElement, w:number, h:number}>}
 */
function computeSlices(bgCanvas, opts) {
	const centre = Math.floor(bgCanvas.width / 2);
	const out = [];
	GROUP_ORDER.forEach((group) => {
		if (!opts[group]) return;
		PIECE_GROUPS[group].forEach((piece) => {
			const h = pieceHeight(piece, bgCanvas.height, opts.longImages);
			out.push({
				key: piece.key,
				file: piece.file,
				label: piece.label,
				canvas: cutPiece(bgCanvas, centre, piece, h).canvas,
				w: piece.w,
				h,
			});
		});
	});
	return out;
}

// Where on the background (in background pixels) a group's box sits - used by
// the live preview to position a background-image behind each mock box.
function groupRect(group, bgWidth) {
	const centre = Math.floor(bgWidth / 2);
	const pieces = PIECE_GROUPS[group];
	const left = centre + pieces[0].dx;
	const last = pieces[pieces.length - 1];
	const right = centre + last.dx + last.w;
	return { left, top: pieces[0].dy, width: right - left };
}

// Live preview: a mock of each showcase box with the background positioned
// behind it exactly where the corresponding piece will be cut, so you can see
// the seam line up (or not) before exporting.
const PREVIEW_SCALE = 0.62;
const PREVIEW_GROUP_LABEL = {
	avatar: 'Avatar',
	featured: 'Featured Showcase',
	artwork: 'Artwork Showcase',
};

function renderPreview(container, bgSrc, bgWidth, bgHeight, opts) {
	container.innerHTML = '';
	const centre = Math.floor(bgWidth / 2);
	const s = PREVIEW_SCALE;

	const bodyH = opts.longImages
		? 320
		: Math.max(40, Math.min(360, bgHeight - SHOWCASE_TOP));

	GROUP_ORDER.forEach((group) => {
		if (!opts[group]) return;

		const row = document.createElement('div');
		row.className = 'bgSliceRow';

		const label = document.createElement('span');
		label.className = 'bgSliceLabel';
		label.textContent = PREVIEW_GROUP_LABEL[group];
		row.appendChild(label);

		const boxes = document.createElement('div');
		boxes.className = 'bgSliceBoxes';

		PIECE_GROUPS[group].forEach((piece) => {
			const h = piece.fixedH || bodyH;
			const box = document.createElement('div');
			box.className = 'bgSliceBox';
			box.style.width = piece.w * s + 'px';
			box.style.height = h * s + 'px';
			box.style.backgroundImage = `url("${bgSrc}")`;
			box.style.backgroundRepeat = 'no-repeat';
			box.style.backgroundSize = `${bgWidth * s}px ${bgHeight * s}px`;
			box.style.backgroundPosition = `${-(centre + piece.dx) * s}px ${
				-piece.dy * s
			}px`;
			if (piece.key === 'avatar') box.classList.add('bgSliceBoxAvatar');
			boxes.appendChild(box);
		});

		row.appendChild(boxes);
		container.appendChild(row);
	});

	if (!container.children.length) {
		const empty = document.createElement('p');
		empty.className = 'reminder';
		empty.textContent = 'Pick at least one showcase to slice for.';
		container.appendChild(empty);
	}
}

async function addPieceToZip(zip, piece, sourceType) {
	const requestedType = sourceType === 'image/apng' ? 'image/png' : sourceType;
	const blob = await canvasToBlob(
		piece.canvas,
		requestedType,
		requestedType === 'image/png' ? undefined : 1
	);

	if (blob.size <= MAX_EXPORT_BYTES) {
		zip.file(
			withExtension(`${piece.file}.x`, blob.type),
			await hexifyBlobByType(blob),
			{ base64: true }
		);
		return;
	}

	// A very detailed source can push a piece past Steam's 5MB cap; PNG has no
	// quality knob so flatten onto black and re-encode as JPEG.
	const source =
		blob.type === 'image/png'
			? flattenToOpaque(piece.canvas, '#000000')
			: piece.canvas;
	const jpegBlob = await compressCanvasToJpegUnderLimit(source);
	zip.file(`${piece.file}.jpg`, await hexifyBlobByType(jpegBlob), {
		base64: true,
	});
}

// A short, shareable link that re-opens the tool on this background with the
// same piece selection. Mirrors steam.design's `#<background>` hash idea.
function layoutLink(bgUrl, opts) {
	const state = {
		bg: bgUrl || null,
		p: GROUP_ORDER.filter((g) => opts[g]),
		long: !!opts.longImages,
	};
	try {
		const base =
			typeof window !== 'undefined'
				? window.location.origin + window.location.pathname
				: '';
		return `${base}#slice=${window.btoa(JSON.stringify(state))}`;
	} catch (e) {
		return '';
	}
}

module.exports = {
	computeSlices,
	groupRect,
	renderPreview,
	addPieceToZip,
	layoutLink,
	GROUP_ORDER,
	PIECE_GROUPS,
	SHOWCASE_TOP,
};
