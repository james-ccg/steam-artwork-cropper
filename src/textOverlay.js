// A small multi-layer overlay system composited onto every exported image -
// inspired by Steam Artwork Creator's Text/Border tools and Layers panel,
// scoped down to fit this app's crop-first (not blank-canvas) architecture:
// text uses a 3x3 alignment grid instead of free dragging, and animation
// presets only actually animate on GIF exports (a static PNG/JPEG has one
// frame, so it always renders the animation's settled state).
let layers = [];
let nextId = 1;
let selectedId = null;

function createTextLayer() {
	return {
		id: nextId++,
		type: 'text',
		visible: true,
		text: 'Your text',
		color: '#ffffff',
		fontSize: 32,
		bold: true,
		align: 'middle-center',
		animation: 'none',
	};
}

function createBorderLayer() {
	return {
		id: nextId++,
		type: 'border',
		visible: true,
		color: '#67c1f5',
		width: 6,
		animation: 'none',
	};
}

function resolveTextPosition(layer, width, height) {
	const marginX = Math.max(10, width * 0.04);
	const marginY = Math.max(10, height * 0.04);
	const [v, h] = layer.align.split('-');
	const x = h === 'left' ? marginX : h === 'right' ? width - marginX : width / 2;
	const y =
		v === 'top'
			? marginY + layer.fontSize / 2
			: v === 'bottom'
			? height - marginY - layer.fontSize / 2
			: height / 2;
	const textAlign = h === 'left' ? 'left' : h === 'right' ? 'right' : 'center';
	return { x, y, textAlign };
}

// progress: 0..1 through the exported frame sequence. Raster (single-frame)
// exports pass 1, i.e. the animation's settled/final look.
function animatedLook(animation, progress, baseColor) {
	let alpha = 1;
	let scale = 1;
	let color = baseColor;
	switch (animation) {
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
	return { alpha, scale, color };
}

function drawTextLayer(ctx, layer, width, height, progress) {
	if (!layer.text) return;
	const { alpha, scale, color } = animatedLook(layer.animation, progress, layer.color);
	const { x, y, textAlign } = resolveTextPosition(layer, width, height);
	const fontSize = Math.max(8, layer.fontSize);

	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.translate(x, y);
	ctx.scale(scale, scale);
	ctx.font = `${layer.bold ? 'bold ' : ''}${fontSize}px "Motiva Sans", Arial, sans-serif`;
	ctx.textAlign = textAlign;
	ctx.textBaseline = 'middle';
	ctx.lineJoin = 'round';
	ctx.lineWidth = Math.max(2, fontSize / 8);
	ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
	ctx.fillStyle = color;
	ctx.strokeText(layer.text, 0, 0);
	ctx.fillText(layer.text, 0, 0);
	ctx.restore();
}

function drawBorderLayer(ctx, layer, width, height, progress) {
	const { alpha, color } = animatedLook(layer.animation, progress, layer.color);
	const w = Math.max(1, layer.width);
	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.strokeStyle = color;
	ctx.lineWidth = w;
	ctx.strokeRect(w / 2, w / 2, Math.max(0, width - w), Math.max(0, height - w));
	ctx.restore();
}

function draw(ctx, width, height, progress) {
	if (progress === undefined) progress = 1;
	layers.forEach(function (layer) {
		if (!layer.visible) return;
		if (layer.type === 'text') drawTextLayer(ctx, layer, width, height, progress);
		else if (layer.type === 'border') drawBorderLayer(ctx, layer, width, height, progress);
	});
}

function hasVisibleContent() {
	return layers.some(function (l) {
		return l.visible && (l.type !== 'text' || l.text);
	});
}

// Draws every visible layer onto a *copy* of a settled (non-gif) canvas, so
// the live preview canvas that fed it stays untouched for repeat exports.
function applyToCanvas(sourceCanvas) {
	if (!hasVisibleContent()) return sourceCanvas;
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

// ---- UI ----

function layerLabel(layer) {
	if (layer.type === 'text') return 'Text: ' + (layer.text || '(empty)');
	return 'Border';
}

function renderLayersList() {
	const container = document.getElementById('overlayLayersList');
	if (!container) return;
	container.innerHTML = '';

	if (layers.length === 0) {
		const empty = document.createElement('p');
		empty.className = 'overlayEmpty';
		empty.textContent = 'No layers yet - add text or a border below.';
		container.appendChild(empty);
		return;
	}

	layers.forEach(function (layer) {
		const row = document.createElement('div');
		row.className = 'overlayLayerRow' + (layer.id === selectedId ? ' selected' : '');

		const label = document.createElement('button');
		label.type = 'button';
		label.className = 'overlayLayerLabel';
		label.textContent = layerLabel(layer);
		label.addEventListener('click', function () {
			selectedId = layer.id;
			renderAll();
		});

		const visBtn = document.createElement('button');
		visBtn.type = 'button';
		visBtn.className = 'overlayIconBtn';
		visBtn.textContent = layer.visible ? 'Hide' : 'Show';
		visBtn.addEventListener('click', function () {
			layer.visible = !layer.visible;
			renderAll();
		});

		const removeBtn = document.createElement('button');
		removeBtn.type = 'button';
		removeBtn.className = 'overlayIconBtn overlayRemoveBtn';
		removeBtn.textContent = 'Remove';
		removeBtn.addEventListener('click', function () {
			layers = layers.filter(function (l) {
				return l.id !== layer.id;
			});
			if (selectedId === layer.id) selectedId = layers.length ? layers[0].id : null;
			renderAll();
		});

		row.appendChild(label);
		row.appendChild(visBtn);
		row.appendChild(removeBtn);
		container.appendChild(row);
	});
}

function field(labelText, inputEl) {
	const wrap = document.createElement('label');
	wrap.className = 'overlayField';
	const span = document.createElement('span');
	span.textContent = labelText;
	wrap.appendChild(span);
	wrap.appendChild(inputEl);
	return wrap;
}

function animationSelectEl(layer) {
	const select = document.createElement('select');
	['none', 'fadeIn', 'pulse', 'rainbow'].forEach(function (val) {
		const opt = document.createElement('option');
		opt.value = val;
		opt.textContent = val === 'none' ? 'None' : val === 'fadeIn' ? 'Fade In' : val === 'pulse' ? 'Pulse' : 'Rainbow';
		if (val === layer.animation) opt.selected = true;
		select.appendChild(opt);
	});
	select.addEventListener('change', function () {
		layer.animation = select.value;
	});
	return select;
}

function renderTextProps(container, layer) {
	const textInput = document.createElement('input');
	textInput.type = 'text';
	textInput.maxLength = 60;
	textInput.value = layer.text;
	textInput.addEventListener('input', function () {
		layer.text = textInput.value;
		renderLayersList();
	});
	container.appendChild(field('Text', textInput));

	const row1 = document.createElement('div');
	row1.className = 'overlayRow';

	const colorInput = document.createElement('input');
	colorInput.type = 'color';
	colorInput.value = layer.color;
	colorInput.addEventListener('input', function () {
		layer.color = colorInput.value;
	});
	row1.appendChild(field('Color', colorInput));

	const sizeInput = document.createElement('input');
	sizeInput.type = 'range';
	sizeInput.min = '12';
	sizeInput.max = '96';
	sizeInput.value = String(layer.fontSize);
	sizeInput.addEventListener('input', function () {
		layer.fontSize = parseInt(sizeInput.value, 10);
	});
	row1.appendChild(field('Size', sizeInput));

	const boldLabel = document.createElement('label');
	boldLabel.className = 'overlayField overlayCheckField';
	const boldInput = document.createElement('input');
	boldInput.type = 'checkbox';
	boldInput.checked = layer.bold;
	boldInput.addEventListener('change', function () {
		layer.bold = boldInput.checked;
	});
	boldLabel.appendChild(boldInput);
	boldLabel.appendChild(document.createTextNode('Bold'));
	row1.appendChild(boldLabel);
	container.appendChild(row1);

	const alignGrid = document.createElement('div');
	alignGrid.className = 'alignGrid';
	['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'].forEach(function (align) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'alignBtn' + (align === layer.align ? ' active' : '');
		btn.title = align.replace('-', ' ');
		btn.addEventListener('click', function () {
			layer.align = align;
			renderProps();
		});
		alignGrid.appendChild(btn);
	});
	container.appendChild(alignGrid);

	const animRow = document.createElement('div');
	animRow.className = 'overlayRow';
	animRow.appendChild(field('Animation', animationSelectEl(layer)));
	const hint = document.createElement('span');
	hint.className = 'overlayHint';
	hint.textContent = '(only visible on GIF exports)';
	animRow.appendChild(hint);
	container.appendChild(animRow);
}

function renderBorderProps(container, layer) {
	const row1 = document.createElement('div');
	row1.className = 'overlayRow';

	const colorInput = document.createElement('input');
	colorInput.type = 'color';
	colorInput.value = layer.color;
	colorInput.addEventListener('input', function () {
		layer.color = colorInput.value;
	});
	row1.appendChild(field('Color', colorInput));

	const widthInput = document.createElement('input');
	widthInput.type = 'number';
	widthInput.min = '1';
	widthInput.max = '40';
	widthInput.value = String(layer.width);
	widthInput.addEventListener('input', function () {
		layer.width = parseInt(widthInput.value, 10) || 1;
	});
	row1.appendChild(field('Width (px)', widthInput));
	container.appendChild(row1);

	const animRow = document.createElement('div');
	animRow.className = 'overlayRow';
	animRow.appendChild(field('Animation', animationSelectEl(layer)));
	const hint = document.createElement('span');
	hint.className = 'overlayHint';
	hint.textContent = '(only visible on GIF exports)';
	animRow.appendChild(hint);
	container.appendChild(animRow);
}

function renderProps() {
	const container = document.getElementById('overlayProps');
	if (!container) return;
	container.innerHTML = '';

	const layer = layers.find(function (l) {
		return l.id === selectedId;
	});
	if (!layer) return;

	const title = document.createElement('p');
	title.className = 'overlayPropsTitle';
	title.textContent = layer.type === 'text' ? 'Text properties' : 'Border properties';
	container.appendChild(title);

	if (layer.type === 'text') renderTextProps(container, layer);
	else renderBorderProps(container, layer);
}

function renderAll() {
	renderLayersList();
	renderProps();
}

function setupTextOverlayControls() {
	const addTextBtn = document.getElementById('addTextLayerBtn');
	const addBorderBtn = document.getElementById('addBorderLayerBtn');
	if (!addTextBtn || !addBorderBtn) return;

	addTextBtn.addEventListener('click', function () {
		const layer = createTextLayer();
		layers.push(layer);
		selectedId = layer.id;
		renderAll();
	});
	addBorderBtn.addEventListener('click', function () {
		const layer = createBorderLayer();
		layers.push(layer);
		selectedId = layer.id;
		renderAll();
	});

	renderAll();
}

module.exports = { draw, applyToCanvas, setupTextOverlayControls };
