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
// x offsets are relative to the background's horizontal centre
// (n = floor(bgWidth / 2)) and are fixed per showcase type (every showcase is
// left-aligned in the 632px customization column). y depends on where the
// showcase sits in the vertical stack, which the user arranges as an ordered
// list; stackTops() turns that order + each showcase's height into a y for
// every piece, using Steam's own widget spacing (profilev2.css).
const CustomCanvas = require('./CustomCanvas');
const {
	MAX_EXPORT_BYTES,
	canvasToBlob,
	flattenToOpaque,
	compressCanvasToJpegUnderLimit,
	withExtension,
} = require('./exportLimit');
const { hexifyBlobByType } = require('./hexify');

// --- Steam widget spacing (profilev2.css) --------------------------------
const STACK_TOP = 241; // top of the first .profile_customization, in bg px
// (calibrated so a .myart showcase first in the stack puts its content at
// y = 256, which is steam.design's published artwork-showcase offset)
const WIDGET_MARGIN = 12; // .profile_customization { margin-bottom: 12px }
const HEADER_H = 40; // .profile_customization_header (30 line-height + 5+5 pad)
const PAD_TOP_MYART = 15; // .myart .profile_customization_block padding-top
const PAD_TOP = 20; // .profile_customization_block padding-top
const PAD_BOTTOM = 11; // ...both have padding-bottom: 11px

const AVATAR_DX = -461;
const AVATAR_TOP = 36;
const AVATAR_SIZE = 164;

// A "long image" piece is cut this tall so the showcase can be dragged to any
// height after upload; only the top of it lines up with the background.
const LONG_IMAGE_HEIGHT = 2000;

// --- Showcase catalog ---------------------------------------------------
// cols: the croppable image columns of a showcase, each {suffix, dx, w}.
// grid: a rows x cols grid of square cells (Workshop 5x3).
const SHOWCASE_TYPES = {
	artwork: {
		label: 'Artwork Showcase',
		file: 'Artwork',
		myart: true,
		header: false,
		defaultH: 300,
		cols: [
			{ suffix: '_Middle', dx: -467, w: 506 },
			{ suffix: '_Side', dx: 48, w: 100 },
		],
	},
	screenshot: {
		label: 'Screenshot Showcase',
		file: 'Screenshot',
		myart: true,
		header: false,
		defaultH: 300,
		cols: [
			{ suffix: '_Middle', dx: -467, w: 506 },
			{ suffix: '_Side', dx: 48, w: 100 },
		],
	},
	featured: {
		label: 'Featured Artwork Showcase',
		file: 'Featured',
		myart: true,
		header: false,
		defaultH: 300,
		cols: [{ suffix: '', dx: -467, w: 630 }],
	},
	workshop: {
		label: 'Workshop Showcase (single item)',
		file: 'Workshop',
		myart: false,
		header: true,
		fixedH: 160,
		cols: [{ suffix: '', dx: -461, w: 160 }],
	},
	spacer: {
		label: 'Empty space / another showcase',
		file: null,
		myart: true,
		header: false,
		defaultH: 120,
		cols: [],
	},
};

const TYPE_KEYS = Object.keys(SHOWCASE_TYPES);

function contentHeight(slot) {
	const t = SHOWCASE_TYPES[slot.type];
	if (t.fixedH) return t.fixedH;
	return Math.max(1, Math.round(slot.height || t.defaultH));
}

function widgetOuterHeight(slot) {
	const t = SHOWCASE_TYPES[slot.type];
	const header = t.header ? HEADER_H : 0;
	const padTop = t.myart ? PAD_TOP_MYART : PAD_TOP;
	return header + padTop + contentHeight(slot) + PAD_BOTTOM + WIDGET_MARGIN;
}

// content-area top (bg px) of every slot, in stack order.
function stackTops(slots) {
	const tops = [];
	let y = STACK_TOP;
	slots.forEach((slot) => {
		const t = SHOWCASE_TYPES[slot.type];
		const header = t.header ? HEADER_H : 0;
		const padTop = t.myart ? PAD_TOP_MYART : PAD_TOP;
		tops.push(y + header + padTop);
		y += widgetOuterHeight(slot);
	});
	return tops;
}

// Cut one rectangle from the background canvas. The rectangle can fall partly
// (or wholly) outside the background - a narrow background, or a long-image
// piece taller than the source - so the piece starts black and only the
// covered region is copied in.
function cutRect(bgCanvas, sx, sy, w, h) {
	const out = new CustomCanvas(w, h);
	out.fillSolid(w, h);

	const cx = Math.max(0, sx);
	const cy = Math.max(0, sy);
	const cw = Math.min(bgCanvas.width, sx + w) - cx;
	const ch = Math.min(bgCanvas.height, sy + h) - cy;
	if (cw > 0 && ch > 0) {
		out.drawImage(bgCanvas, cx, cy, cw, ch, cx - sx, cy - sy, cw, ch);
	}
	return out.canvas;
}

/**
 * The rectangle (in background pixels) each showcase piece is cut from.
 * Shared by the still slicer (cutRect per rect) and the animated slicer
 * (ffmpeg crop per rect).
 * @param {number} bgWidth  background native width
 * @param {{slots:Array<{type:string,height?:number}>, avatar:boolean, longImages:boolean}} opts
 * @returns {Array<{file:string, sx:number, sy:number, w:number, h:number}>}
 */
function sliceRects(bgWidth, opts) {
	const centre = Math.floor(bgWidth / 2);
	const out = [];

	if (opts.avatar) {
		out.push({
			file: 'Avatar',
			sx: centre + AVATAR_DX,
			sy: AVATAR_TOP,
			w: AVATAR_SIZE,
			h: AVATAR_SIZE,
		});
	}

	const slots = opts.slots || [];
	const tops = stackTops(slots);
	slots.forEach((slot, i) => {
		const t = SHOWCASE_TYPES[slot.type];
		if (!t || !t.file || !t.cols.length) return; // spacer / unknown
		const top = tops[i];
		const h = opts.longImages && !t.fixedH ? LONG_IMAGE_HEIGHT : contentHeight(slot);
		const prefix = slots.length > 1 ? `${i + 1}_` : '';
		t.cols.forEach((col) => {
			out.push({
				file: `${prefix}${t.file}${col.suffix}`,
				sx: centre + col.dx,
				sy: top,
				w: col.w,
				h,
			});
		});
	});

	return out;
}

/**
 * @param {HTMLCanvasElement} bgCanvas  background at its native resolution
 * @param {object} opts  see sliceRects
 * @returns {Array<{file:string, canvas:HTMLCanvasElement, w:number, h:number}>}
 */
function computeSlices(bgCanvas, opts) {
	return sliceRects(bgCanvas.width, opts).map((r) => ({
		file: r.file,
		w: r.w,
		h: r.h,
		canvas: cutRect(bgCanvas, r.sx, r.sy, r.w, r.h),
	}));
}

// --- live preview ------------------------------------------------------
// A scaled mock of the stack: each showcase box shows the background pixels
// it will be cut from, so the seam is visible (or not) before exporting.
const PREVIEW_SCALE = 0.6;
const PREVIEW_MAX_BOX_H = 220;

function renderPreview(container, bgSrc, bgWidth, bgHeight, opts) {
	container.innerHTML = '';
	const centre = Math.floor(bgWidth / 2);
	const s = PREVIEW_SCALE;
	const bgW = bgWidth * s;
	const bgH = bgHeight * s;

	function box(dx, w, top, h, extraClass) {
		const el = document.createElement('div');
		el.className = 'bgSliceBox' + (extraClass ? ' ' + extraClass : '');
		el.style.width = w * s + 'px';
		el.style.height = Math.min(PREVIEW_MAX_BOX_H, h * s) + 'px';
		el.style.backgroundImage = `url("${bgSrc}")`;
		el.style.backgroundRepeat = 'no-repeat';
		el.style.backgroundSize = `${bgW}px ${bgH}px`;
		el.style.backgroundPosition = `${-(centre + dx) * s}px ${-top * s}px`;
		return el;
	}

	function row(label, boxesEl) {
		const r = document.createElement('div');
		r.className = 'bgSliceRow';
		const l = document.createElement('span');
		l.className = 'bgSliceLabel';
		l.textContent = label;
		r.appendChild(l);
		r.appendChild(boxesEl);
		return r;
	}

	if (opts.avatar) {
		const b = document.createElement('div');
		b.className = 'bgSliceBoxes';
		b.appendChild(
			box(AVATAR_DX, AVATAR_SIZE, AVATAR_TOP, AVATAR_SIZE, 'bgSliceBoxAvatar')
		);
		container.appendChild(row('Avatar', b));
	}

	const slots = opts.slots || [];
	const tops = stackTops(slots);
	slots.forEach((slot, i) => {
		const t = SHOWCASE_TYPES[slot.type];
		if (!t) return;
		const top = tops[i];
		const h = opts.longImages && !t.fixedH ? LONG_IMAGE_HEIGHT : contentHeight(slot);
		const boxes = document.createElement('div');
		boxes.className = 'bgSliceBoxes';
		if (t.cols.length) {
			t.cols.forEach((col) => boxes.appendChild(box(col.dx, col.w, top, h)));
		} else {
			const ghost = document.createElement('div');
			ghost.className = 'bgSliceBox bgSliceBoxGhost';
			ghost.style.width = 506 * s + 'px';
			ghost.style.height = Math.min(PREVIEW_MAX_BOX_H, h * s) + 'px';
			boxes.appendChild(ghost);
		}
		container.appendChild(row(t.label, boxes));
	});

	if (!container.children.length) {
		const p = document.createElement('p');
		p.className = 'reminder';
		p.textContent = 'Add a showcase (or the avatar) to slice for.';
		container.appendChild(p);
	}
}

async function addPieceToZip(zip, piece, sourceType, format) {
	// format: 'png' | 'jpg' | null (follow the source). Avatars and the
	// bundled Background always follow the source type.
	let requestedType = sourceType === 'image/apng' ? 'image/png' : sourceType;
	if (format === 'png') requestedType = 'image/png';
	else if (format === 'jpg') requestedType = 'image/jpeg';

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
// same stack. Mirrors steam.design's `#<background>` hash idea.
function layoutLink(bgUrl, opts) {
	const state = {
		bg: bgUrl || null,
		s: (opts.slots || []).map((sl) => [sl.type, sl.height || 0]),
		a: !!opts.avatar,
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

function parseLayoutLink(hash) {
	try {
		const m = /#slice=([A-Za-z0-9+/=]+)/.exec(hash || '');
		if (!m) return null;
		const st = JSON.parse(window.atob(m[1]));
		return {
			bg: st.bg || null,
			slots: (st.s || [])
				.filter((row) => SHOWCASE_TYPES[row[0]])
				.map((row) => ({ type: row[0], height: row[1] || 0 })),
			avatar: !!st.a,
			longImages: !!st.long,
		};
	} catch (e) {
		return null;
	}
}

module.exports = {
	SHOWCASE_TYPES,
	TYPE_KEYS,
	computeSlices,
	sliceRects,
	stackTops,
	renderPreview,
	addPieceToZip,
	layoutLink,
	parseLayoutLink,
};
