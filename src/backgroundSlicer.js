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
	favoriteguide: {
		label: 'Favorite Guide',
		file: 'FavoriteGuide',
		myart: false,
		header: true,
		fixedH: 160,
		cols: [{ suffix: '', dx: -461, w: 160 }],
	},
	// Grids: `grid` describes a rows x cols layout of equal cells. Each row's
	// height is `slot.height` (one value for the whole grid); rowGap is Steam's
	// margin between cells.
	workshopgrid: {
		label: 'Workshop Showcase (5×3 grid)',
		file: 'Workshop',
		myart: false,
		header: true,
		defaultH: 122,
		grid: { rows: 3, cols: 5, cellW: 122.4, colPitch: 126.4, gap: 4, dx0: -465 },
	},
	guides: {
		label: 'My Guides (4×2 grid)',
		file: 'Guide',
		myart: false,
		header: true,
		fixedH: 66,
		grid: { rows: 4, cols: 2, cellW: 66, colPitch: 314, gap: 7, dx0: -456 },
	},
	achievements: {
		label: 'Achievement Showcase (7×3 grid)',
		file: 'Achievement',
		myart: false,
		header: true,
		fixedH: 64,
		grid: { rows: 3, cols: 7, cellW: 64, colPitch: 90, gap: 5, dx0: -459 },
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

function rowHeight(slot) {
	const t = SHOWCASE_TYPES[slot.type];
	if (t.fixedH) return t.fixedH;
	return Math.max(1, Math.round(slot.height || t.defaultH));
}

// The on-profile height of a slot's content area. A lone non-grid showcase
// with no explicit height fills from its top down to the bottom of the
// background (fillH) - that's the "no size to pick" case. Grids and stacked
// showcases use their set/default height so the pieces below land right.
function contentHeight(slot, fillH) {
	const t = SHOWCASE_TYPES[slot.type];
	if (t.grid) {
		return t.grid.rows * rowHeight(slot) + (t.grid.rows - 1) * t.grid.gap;
	}
	if (!t.fixedH && !slot.height && fillH > 0) return fillH;
	return rowHeight(slot);
}

// content-area top (bg px) of every slot, in stack order.
function stackTops(slots, bgHeight) {
	const tops = [];
	const singleFill = slots.length === 1;
	let y = STACK_TOP;
	slots.forEach((slot) => {
		const t = SHOWCASE_TYPES[slot.type];
		const header = t.header ? HEADER_H : 0;
		const padTop = t.myart ? PAD_TOP_MYART : PAD_TOP;
		const top = y + header + padTop;
		tops.push(top);
		const fillH = singleFill && bgHeight ? bgHeight - top : 0;
		y +=
			header +
			padTop +
			contentHeight(slot, fillH) +
			PAD_BOTTOM +
			WIDGET_MARGIN;
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

// Steam renders a square background as a repeating tile. A slice of it must
// therefore tile too, so instead of black-filling anything outside the source
// this repeats the tile across the whole piece (from the right phase).
function cutRectTiled(bgCanvas, sx, sy, w, h) {
	const out = new CustomCanvas(w, h);
	const ctx = out.canvas.getContext('2d');
	const bw = bgCanvas.width;
	const bh = bgCanvas.height;
	const x0 = ((sx % bw) + bw) % bw;
	const y0 = ((sy % bh) + bh) % bh;
	for (let dy = -y0; dy < h; dy += bh) {
		for (let dx = -x0; dx < w; dx += bw) {
			ctx.drawImage(bgCanvas, dx, dy);
		}
	}
	return out.canvas;
}

function isTiling(width, height) {
	return width === height && (width === 512 || width === 256);
}

/**
 * The rectangle (in background pixels) each showcase piece is cut from.
 * Shared by the still slicer (cutRect per rect) and the animated slicer
 * (ffmpeg crop per rect).
 * @param {number} bgWidth   background native width
 * @param {number} bgHeight  background native height (for fill-to-bottom)
 * @param {{slots:Array<{type:string,height?:number}>, avatar:boolean}} opts
 * @returns {Array<{file:string, sx:number, sy:number, w:number, h:number}>}
 */
function sliceRects(bgWidth, bgHeight, opts) {
	const centre = Math.floor(bgWidth / 2);
	const out = [];

	if (opts.avatar) {
		out.push({
			file: 'Avatar',
			group: 'avatar',
			groupLabel: 'Avatar',
			sx: centre + AVATAR_DX,
			sy: AVATAR_TOP,
			w: AVATAR_SIZE,
			h: AVATAR_SIZE,
		});
	}

	const slots = opts.slots || [];
	const tops = stackTops(slots, bgHeight);
	const singleFill = slots.length === 1;
	slots.forEach((slot, i) => {
		const t = SHOWCASE_TYPES[slot.type];
		if (!t || !t.file || (!t.grid && !(t.cols && t.cols.length))) return;
		const top = tops[i];
		const prefix = slots.length > 1 ? `${i + 1}_` : '';
		const group = `slot${i}`;

		if (t.grid) {
			const g = t.grid;
			const rh = rowHeight(slot);
			for (let k = 0; k < g.rows; k++) {
				const rowTop = Math.round(top + k * (rh + g.gap));
				for (let c = 0; c < g.cols; c++) {
					out.push({
						file: `${prefix}${t.file}_r${k + 1}c${c + 1}`,
						group,
						groupLabel: t.label,
						sx: Math.round(centre + g.dx0 + c * g.colPitch),
						sy: rowTop,
						w: Math.round(g.cellW),
						h: rh,
					});
				}
			}
			return;
		}

		const fillH = singleFill && bgHeight ? bgHeight - top : 0;
		const h = contentHeight(slot, fillH);
		t.cols.forEach((col) => {
			out.push({
				file: `${prefix}${t.file}${col.suffix}`,
				group,
				groupLabel: t.label,
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
	const cut = isTiling(bgCanvas.width, bgCanvas.height) ? cutRectTiled : cutRect;
	return sliceRects(bgCanvas.width, bgCanvas.height, opts).map((r) => ({
		file: r.file,
		w: r.w,
		h: r.h,
		canvas: cut(bgCanvas, r.sx, r.sy, r.w, r.h),
	}));
}

// --- live preview ------------------------------------------------------
// A scaled mock of the stack: each showcase box shows the background pixels
// it will be cut from, so the seam is visible (or not) before exporting.
const PREVIEW_SCALE = 0.6;
const PREVIEW_MAX_BOX_H = 220;

function renderPreview(container, bgSrc, bgWidth, bgHeight, opts) {
	container.innerHTML = '';
	const s = PREVIEW_SCALE;

	// Drive the preview straight off sliceRects() so grids and single showcases
	// use the exact same geometry that the export does.
	const byGroup = {};
	sliceRects(bgWidth, bgHeight, opts).forEach((r) => {
		(byGroup[r.group] = byGroup[r.group] || []).push(r);
	});

	function addRow(label, rectsOrGhost) {
		const rowEl = document.createElement('div');
		rowEl.className = 'bgSliceRow';
		const l = document.createElement('span');
		l.className = 'bgSliceLabel';
		l.textContent = label;
		rowEl.appendChild(l);

		const boxes = document.createElement('div');
		boxes.className = 'bgSliceBoxes';

		if (rectsOrGhost === 'ghost') {
			const ghost = document.createElement('div');
			ghost.className = 'bgSliceBox bgSliceBoxGhost';
			ghost.style.width = 300 * s + 'px';
			ghost.style.height = 40 + 'px';
			boxes.appendChild(ghost);
		} else {
			// A grid (many cells) is drawn at a reduced scale so all its
			// columns fit the panel; a single showcase uses the full scale.
			const cols = new Set(rectsOrGhost.map((r) => r.sx)).size;
			const isGrid = rectsOrGhost.length > cols;
			const cs = isGrid
				? Math.min(s, 600 / (cols * rectsOrGhost[0].w))
				: s;
			if (isGrid) {
				boxes.classList.add('bgSliceBoxesGrid');
				boxes.style.gridTemplateColumns = `repeat(${cols}, ${
					rectsOrGhost[0].w * cs
				}px)`;
			}
			rectsOrGhost.forEach((r) => {
				const el = document.createElement('div');
				el.className =
					'bgSliceBox' + (r.group === 'avatar' ? ' bgSliceBoxAvatar' : '');
				el.style.width = r.w * cs + 'px';
				el.style.height = Math.min(PREVIEW_MAX_BOX_H, r.h * cs) + 'px';
				el.style.backgroundImage = `url("${bgSrc}")`;
				el.style.backgroundRepeat = 'no-repeat';
				el.style.backgroundSize = `${bgWidth * cs}px ${bgHeight * cs}px`;
				el.style.backgroundPosition = `${-r.sx * cs}px ${-r.sy * cs}px`;
				boxes.appendChild(el);
			});
		}
		rowEl.appendChild(boxes);
		container.appendChild(rowEl);
	}

	if (byGroup.avatar) addRow('Avatar', byGroup.avatar);

	(opts.slots || []).forEach((slot, i) => {
		const t = SHOWCASE_TYPES[slot.type];
		if (!t) return;
		if (byGroup['slot' + i]) addRow(t.label, byGroup['slot' + i]);
		else addRow(t.label, 'ghost'); // spacer / unmodelled
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
// same stack + options. Mirrors steam.design's `#<background>` hash idea.
function layoutLink(bgUrl, opts) {
	const state = {
		bg: bgUrl || null,
		s: (opts.slots || []).map((sl) => [sl.type, sl.height || 0]),
		a: !!opts.avatar,
		f: opts.format && opts.format !== 'png' ? opts.format : undefined,
		af: opts.animFormat && opts.animFormat !== 'webm' ? opts.animFormat : undefined,
		afps: opts.animFps || undefined,
		aq: opts.animQuality || undefined,
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
			avatar: st.a === undefined ? true : !!st.a,
			format: st.f || 'png',
			animFormat: st.af || null,
			animFps: st.afps || 0,
			animQuality: st.aq || 0,
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
	renderPreview,
	addPieceToZip,
	layoutLink,
	parseLayoutLink,
};
