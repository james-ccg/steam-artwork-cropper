/* eslint-disable no-undef */
// Background Slicer - the whole job of the Background Cropper.
//
// Steam has no upload flow for putting a background *behind* a showcase, so
// the trick every background-slicing tool uses (steam.design, Steam Artwork
// Hub, ...) is: cut the exact rectangle of the background that the showcase
// will end up covering, upload that rectangle *as* the showcase's image, and
// the showcase reads as an uncut continuation of the background - the profile
// looks like one seamless picture.
//
// Like steam.design, this keeps it simple: one showcase, cut at the fixed
// position it sits on the profile (x relative to the background's horizontal
// centre, y from the top), filling from there down to the bottom of the
// background. The avatar is one 164px square. No stacking, no size to pick.
const CustomCanvas = require('./CustomCanvas');
const {
	MAX_EXPORT_BYTES,
	canvasToBlob,
	flattenToOpaque,
	compressCanvasToJpegUnderLimit,
	withExtension,
} = require('./exportLimit');
const { hexifyBlobByType } = require('./hexify');

const AVATAR = { dx: -461, top: 36, size: 164 };

// Where each showcase's image area sits on the profile. `top` is calibrated
// from steam.design's published y:256 for an Artwork/Featured showcase (the
// first thing in the left column); a Workshop showcase carries a 40px header
// bar, so its item starts lower. `cols` are the image columns the showcase
// renders as - Artwork = a 506px primary + a 100px secondary column past a
// ~9px gutter (c-467 -> c+48).
const SHOWCASE_TYPES = {
	artwork: {
		label: 'Artwork Showcase',
		file: 'Artwork',
		top: 256,
		cols: [
			{ suffix: '_Middle', dx: -467, w: 506 },
			{ suffix: '_Side', dx: 48, w: 100 },
		],
	},
	screenshot: {
		label: 'Screenshot Showcase',
		file: 'Screenshot',
		top: 256,
		cols: [
			{ suffix: '_Middle', dx: -467, w: 506 },
			{ suffix: '_Side', dx: 48, w: 100 },
		],
	},
	featured: {
		label: 'Featured Artwork Showcase',
		file: 'Featured',
		top: 256,
		cols: [{ suffix: '', dx: -467, w: 630 }],
	},
	workshop: {
		label: 'Workshop Showcase',
		file: 'Workshop',
		top: 301,
		cols: [{ suffix: '', dx: -461, w: 160 }],
	},
};

const TYPE_KEYS = Object.keys(SHOWCASE_TYPES);

// Cut one rectangle from the background canvas. The rectangle can fall partly
// (or wholly) outside a small background, so the piece starts black and only
// the covered region is copied in.
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

// Steam renders a square background as a repeating tile, so a slice of it must
// tile too - repeat the tile across the whole piece from the right phase
// instead of black-filling anything outside the source.
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
 * The rectangle (in background pixels) each piece is cut from - shared by the
 * still slicer (cutRect) and the animated slicer (ffmpeg crop).
 * @param {number} bgWidth
 * @param {number} bgHeight
 * @param {{showcase:?string, avatar:boolean}} opts
 * @returns {Array<{file:string, group:string, groupLabel:string, sx,sy,w,h:number}>}
 */
function sliceRects(bgWidth, bgHeight, opts) {
	const centre = Math.floor(bgWidth / 2);
	const out = [];

	if (opts.avatar) {
		out.push({
			file: 'Avatar',
			group: 'avatar',
			groupLabel: 'Avatar',
			sx: centre + AVATAR.dx,
			sy: AVATAR.top,
			w: AVATAR.size,
			h: AVATAR.size,
		});
	}

	const t = opts.showcase && SHOWCASE_TYPES[opts.showcase];
	if (t) {
		const h = Math.max(1, (bgHeight || 1200) - t.top);
		t.cols.forEach((col) => {
			out.push({
				file: `${t.file}${col.suffix}`,
				group: 'showcase',
				groupLabel: t.label,
				sx: centre + col.dx,
				sy: t.top,
				w: col.w,
				h,
			});
		});
	}

	return out;
}

/**
 * @param {HTMLCanvasElement} bgCanvas  background at its native resolution
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
// Each box shows the background pixels its piece will be cut from, so the
// seam is visible (or not) before exporting.
const PREVIEW_SCALE = 0.6;
const PREVIEW_MAX_BOX_H = 240;

function renderPreview(container, bgSrc, bgWidth, bgHeight, opts) {
	container.innerHTML = '';
	const s = PREVIEW_SCALE;
	const byGroup = {};
	sliceRects(bgWidth, bgHeight, opts).forEach((r) => {
		(byGroup[r.group] = byGroup[r.group] || []).push(r);
	});

	function addRow(label, rects) {
		const rowEl = document.createElement('div');
		rowEl.className = 'bgSliceRow';
		const l = document.createElement('span');
		l.className = 'bgSliceLabel';
		l.textContent = label;
		rowEl.appendChild(l);

		const boxes = document.createElement('div');
		boxes.className = 'bgSliceBoxes';
		rects.forEach((r) => {
			const el = document.createElement('div');
			el.className =
				'bgSliceBox' + (r.group === 'avatar' ? ' bgSliceBoxAvatar' : '');
			el.style.width = r.w * s + 'px';
			el.style.height = Math.min(PREVIEW_MAX_BOX_H, r.h * s) + 'px';
			el.style.backgroundImage = `url("${bgSrc}")`;
			el.style.backgroundRepeat = 'no-repeat';
			el.style.backgroundSize = `${bgWidth * s}px ${bgHeight * s}px`;
			el.style.backgroundPosition = `${-r.sx * s}px ${-r.sy * s}px`;
			boxes.appendChild(el);
		});
		rowEl.appendChild(boxes);
		container.appendChild(rowEl);
	}

	if (byGroup.avatar) addRow('Avatar', byGroup.avatar);
	if (byGroup.showcase) addRow(byGroup.showcase[0].groupLabel, byGroup.showcase);

	if (!container.children.length) {
		const p = document.createElement('p');
		p.className = 'reminder';
		p.textContent = 'Pick a showcase (or the avatar) to slice for.';
		container.appendChild(p);
	}
}

async function addPieceToZip(zip, piece, sourceType, format) {
	// format: 'png' | 'jpg' | null (follow the source). The Avatar and the
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
	// quality knob, so flatten onto black and re-encode as JPEG.
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
// same choices. Mirrors steam.design's `#<background>` hash idea.
function layoutLink(bgUrl, opts) {
	const state = {
		bg: bgUrl || null,
		sc: opts.showcase || null,
		a: !!opts.avatar,
		f: opts.format && opts.format !== 'png' ? opts.format : undefined,
		af:
			opts.animFormat && opts.animFormat !== 'webm'
				? opts.animFormat
				: undefined,
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
			showcase: SHOWCASE_TYPES[st.sc] ? st.sc : null,
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
