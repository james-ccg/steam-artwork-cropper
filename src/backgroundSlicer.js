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

// A Workshop Showcase is not one image - it is a strip of five item slots.
// Measured off the Steam markup this page recreates: the strip is 628px wide
// starting at centre-464, each slot 122.4px with a 4px gap, which is exactly
// where the Artwork Creator's own Workshop cropper puts its five crop lines
// (-340.9, -214.5, -89.5, +36.9 - each the 4px gap between two slots).
const WORKSHOP_SLOT_WIDTH = 122.4;
const WORKSHOP_SLOT_GAP = 4;
const WORKSHOP_STRIP_LEFT = -464;
const WORKSHOP_SLOTS = 5;

function workshopCols() {
	const cols = [];
	for (let i = 0; i < WORKSHOP_SLOTS; i++) {
		const left =
			WORKSHOP_STRIP_LEFT + i * (WORKSHOP_SLOT_WIDTH + WORKSHOP_SLOT_GAP);
		const dx = Math.round(left);
		cols.push({
			suffix: `_${i + 1}`,
			dx,
			// Round both edges rather than the width, so consecutive slots stay
			// on Steam's fractional 122.4 pitch instead of drifting.
			w: Math.round(left + WORKSHOP_SLOT_WIDTH) - dx,
		});
	}
	return cols;
}

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
		layout: 'strip',
		cols: workshopCols(),
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
				layout: t.layout || 'panel',
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
// The reference tools (steam.design, Steam Artwork Hub) never show the pieces
// as a separate stack of boxes beside the profile - they show the profile
// itself with the pieces already sitting in it, which is the entire point of
// slicing. So does this: each cut region is painted straight into a real Steam
// showcase slot at its native size, and the avatar piece is painted onto the
// mock profile's own avatar. Nothing is ever drawn twice.
// Direct child only. `.playerAvatarAutoSizeInner` holds the animated frame
// (inside .profile_avatar_frame) *before* the avatar, so a descendant
// selector matches the frame - which is 224px art drawn at 200px so it can
// overhang the 164px avatar. Painting that one both put the slice on the
// wrong layer and resized the frame on every mode switch.
const AVATAR_IMG_SELECTOR = '#avatarHoverTarget .playerAvatarAutoSizeInner > img';
const DEFAULT_AVATAR_SRC = './steam/imgs/james_avatar.jpg';

function el(tag, className) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	return node;
}

// A slot's contents: the background, unscaled, shifted so the slot window
// lands exactly on the region that piece is cut from.
function fillEl(bgSrc, r) {
	const fill = el('div', 'bgSliceFill');
	fill.style.width = r.w + 'px';
	fill.style.height = r.h + 'px';
	fill.style.backgroundImage = `url("${bgSrc}")`;
	fill.style.backgroundRepeat = 'no-repeat';
	fill.style.backgroundPosition = `${-r.sx}px ${-r.sy}px`;
	return fill;
}

// A Workshop Showcase renders as one row of item slots, so its preview is a
// strip rather than the primary/right-column pair the other showcases use.
// The gap between slots is Steam's own 4px, which is background the piece is
// NOT cut from - showing it keeps the slot boundaries honest.
function workshopStripMock(bgSrc, rects) {
	const wrap = el('div', 'screenshot_showcase bgWorkshopStrip');
	rects.forEach((r) => {
		const slot = el('div', 'bgWorkshopSlot');
		slot.appendChild(fillEl(bgSrc, r));
		wrap.appendChild(slot);
	});
	return wrap;
}

// Steam's own showcase markup (profilev2.css does the rest) - a primary slot
// and, for an Artwork/Screenshot showcase, the narrow right-hand column.
function showcaseMock(bgSrc, rects) {
	if (rects[0] && rects[0].layout === 'strip') {
		return workshopStripMock(bgSrc, rects);
	}
	const wrap = el('div', 'screenshot_showcase');

	const primary = el(
		'div',
		'screenshot_showcase_primary showcase_slot' +
			(rects.length > 1 ? '' : ' single')
	);
	const shot = el('div', 'screenshot_showcase_screenshot');
	shot.style.width = rects[0].w + 'px';
	shot.style.maxWidth = rects[0].w + 'px';
	shot.appendChild(fillEl(bgSrc, rects[0]));
	primary.appendChild(shot);
	primary.appendChild(el('div', 'screenshot_showcase_itemname'));
	wrap.appendChild(primary);

	if (rects[1]) {
		const rightcol = el('div', 'screenshot_showcase_rightcol');
		const small = el(
			'div',
			'screenshot_showcase_smallscreenshot showcase_slot'
		);
		const smallShot = el('div', 'screenshot_showcase_screenshot');
		smallShot.appendChild(fillEl(bgSrc, rects[1]));
		small.appendChild(smallShot);
		rightcol.appendChild(small);
		wrap.appendChild(rightcol);
	}

	const clear = el('div');
	clear.style.clear = 'both';
	wrap.appendChild(clear);
	return wrap;
}

// Steam shows one avatar, so the avatar piece is previewed on the real one
// rather than as a second copy. object-fit:none + a negative object-position
// windows straight onto the region without re-encoding anything.
function paintAvatar(bgSrc, rect) {
	const img = document.querySelector(AVATAR_IMG_SELECTOR);
	if (!img) return;
	if (!rect || !bgSrc) {
		img.src = DEFAULT_AVATAR_SRC;
		img.style.removeProperty('object-fit');
		img.style.removeProperty('object-position');
		return;
	}
	// The avatar box is already exactly 164 square in Steam's own CSS, which is
	// the piece's size, so object-fit:none windows straight onto the region.
	// Nothing here touches the element's size - doing so is what made the avatar
	// jump between modes.
	img.src = bgSrc;
	img.style.objectFit = 'none';
	img.style.objectPosition = `${-rect.sx}px ${-rect.sy}px`;
}

function resetAvatar() {
	paintAvatar(null, null);
}

// The mock's header carries the tool's own controls, so the showcase below it
// does not land on exactly the background row the slices are cut from (Steam's
// own layout puts an Artwork Showcase at y=256 when the header is at its
// minimum height). Nudge the preview by the measured difference so each piece
// is drawn on the background pixels it was actually cut from - otherwise the
// composite reads as misaligned even though the exported pieces are correct.
function alignToBackground(container, rects, bgWidth) {
	container.style.removeProperty('margin-top');
	container.style.removeProperty('margin-left');
	if (!rects.length) return;

	const bgEl = document.querySelector(
		'.no_header.profile_page.has_profile_background'
	);
	const fill = container.querySelector('.bgSliceFill');
	if (!bgEl || !fill) return;

	// Steam draws a static background at native size, centred and top-pinned,
	// so background pixel (sx, sy) lands at (centre - bgWidth/2 + sx, top + sy).
	const bg = bgEl.getBoundingClientRect();
	const originX = bg.left + bg.width / 2 - Math.floor(bgWidth / 2);
	const got = fill.getBoundingClientRect();

	const dx = Math.round(originX + rects[0].sx - got.left);
	const dy = Math.round(bg.top + rects[0].sy - got.top);
	if (dx) container.style.marginLeft = dx + 'px';
	if (dy) container.style.marginTop = dy + 'px';
}

function renderPreview(container, bgSrc, bgWidth, bgHeight, opts) {
	container.innerHTML = '';
	const rects = sliceRects(bgWidth, bgHeight, opts);
	const showcaseRects = rects.filter((r) => r.group === 'showcase');
	const avatarRect = rects.filter((r) => r.group === 'avatar')[0];

	paintAvatar(bgSrc, avatarRect);

	// The mock's own header names whatever is being previewed in it, the way a
	// real profile labels the showcase sitting there.
	const header = document.querySelector(
		'#backgroundArea .profile_customization_header'
	);
	if (header) {
		header.textContent = showcaseRects.length
			? showcaseRects[0].groupLabel
			: 'Profile Background';
	}

	if (showcaseRects.length) {
		container.appendChild(showcaseMock(bgSrc, showcaseRects));
		alignToBackground(container, showcaseRects, bgWidth);
		return;
	}

	const p = el('p', 'reminder');
	p.textContent = avatarRect
		? "Only the avatar is being cut - it's previewed on the profile avatar above."
		: 'Pick a showcase (or the avatar) to slice for.';
	container.appendChild(p);
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
	resetAvatar,
	addPieceToZip,
	layoutLink,
	parseLayoutLink,
};
