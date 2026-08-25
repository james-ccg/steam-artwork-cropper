// A single caption layer composited onto every exported image - inspired by
// Steam Artwork Creator's text tool, scoped down to fit this app's
// crop-first (not blank-canvas) architecture: one line of text, a 3x3
// alignment grid instead of free dragging, and a few animation presets that
// only actually animate on GIF exports (a static PNG/JPEG has one frame, so
// it always renders the animation's settled state).
const state = {
	enabled: false,
	text: '',
	color: '#ffffff',
	fontSize: 32,
	bold: true,
	align: 'middle-center',
	animation: 'none',
};

function resolvePosition(width, height) {
	const marginX = Math.max(10, width * 0.04);
	const marginY = Math.max(10, height * 0.04);
	const [v, h] = state.align.split('-');
	const x = h === 'left' ? marginX : h === 'right' ? width - marginX : width / 2;
	const y =
		v === 'top'
			? marginY + state.fontSize / 2
			: v === 'bottom'
			? height - marginY - state.fontSize / 2
			: height / 2;
	const textAlign = h === 'left' ? 'left' : h === 'right' ? 'right' : 'center';
	return { x, y, textAlign };
}

// progress: 0..1 through the exported frame sequence. Raster (single-frame)
// exports pass 1, i.e. the animation's settled/final look.
function draw(ctx, width, height, progress) {
	if (!state.enabled || !state.text) return;
	if (progress === undefined) progress = 1;

	let alpha = 1;
	let scale = 1;
	let color = state.color;
	switch (state.animation) {
		case 'fadeIn':
			alpha = Math.min(1, progress / 0.3);
			break;
		case 'pulse':
			scale = 1 + 0.12 * Math.sin(progress * Math.PI * 2 * 3);
			break;
		case 'rainbow':
			color = `hsl(${Math.round(progress * 720) % 360}, 85%, 60%)`;
			break;
	}

	const { x, y, textAlign } = resolvePosition(width, height);
	const fontSize = Math.max(8, state.fontSize);

	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.translate(x, y);
	ctx.scale(scale, scale);
	ctx.font = `${state.bold ? 'bold ' : ''}${fontSize}px "Motiva Sans", Arial, sans-serif`;
	ctx.textAlign = textAlign;
	ctx.textBaseline = 'middle';
	ctx.lineJoin = 'round';
	ctx.lineWidth = Math.max(2, fontSize / 8);
	ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
	ctx.fillStyle = color;
	ctx.strokeText(state.text, 0, 0);
	ctx.fillText(state.text, 0, 0);
	ctx.restore();
}

// Draws the overlay onto a *copy* of a settled (non-gif) canvas, so the live
// preview canvas that fed it stays untouched for repeat exports.
function applyToCanvas(sourceCanvas) {
	if (!state.enabled || !state.text) return sourceCanvas;
	// drawImage() throws on a 0-sized source (unlike canvas.toBlob(), which
	// tolerates it) - nothing useful to overlay onto a degenerate canvas anyway.
	if (sourceCanvas.width === 0 || sourceCanvas.height === 0) return sourceCanvas;
	const out = document.createElement('canvas');
	out.width = sourceCanvas.width;
	out.height = sourceCanvas.height;
	const ctx = out.getContext('2d');
	ctx.drawImage(sourceCanvas, 0, 0);
	draw(ctx, out.width, out.height, 1);
	return out;
}

function setupTextOverlayControls() {
	const enabledCheckbox = document.getElementById('textOverlayEnabled');
	const controls = document.getElementById('textOverlayControls');
	const textInput = document.getElementById('textOverlayText');
	const colorInput = document.getElementById('textOverlayColor');
	const sizeInput = document.getElementById('textOverlaySize');
	const boldInput = document.getElementById('textOverlayBold');
	const animationSelect = document.getElementById('textOverlayAnimation');
	const alignButtons = document.querySelectorAll(
		'#textOverlayAlignGrid .alignBtn'
	);
	if (!enabledCheckbox) return;

	enabledCheckbox.addEventListener('change', function () {
		state.enabled = enabledCheckbox.checked;
		controls.style.display = state.enabled ? '' : 'none';
	});
	textInput.addEventListener('input', function () {
		state.text = textInput.value;
	});
	colorInput.addEventListener('input', function () {
		state.color = colorInput.value;
	});
	sizeInput.addEventListener('input', function () {
		state.fontSize = parseInt(sizeInput.value, 10);
	});
	boldInput.addEventListener('change', function () {
		state.bold = boldInput.checked;
	});
	animationSelect.addEventListener('change', function () {
		state.animation = animationSelect.value;
	});
	alignButtons.forEach(function (btn) {
		btn.addEventListener('click', function () {
			state.align = btn.dataset.align;
			alignButtons.forEach(function (b) {
				b.classList.toggle('active', b === btn);
			});
		});
	});
}

module.exports = { draw, applyToCanvas, setupTextOverlayControls, state };
