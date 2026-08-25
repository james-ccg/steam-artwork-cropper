// This tool measures and crops images against a pixel-accurate recreation of
// the Steam profile page, which only makes sense on a desktop-sized window
// with a mouse (dragging/resizing the workshop slider, precise cropping).
// Rather than silently handing phones/tablets/narrow windows a broken,
// squished layout, block entry outright and say why.
const MIN_WIDTH = 1024;

function isSupportedDevice() {
	const wideEnough = window.innerWidth >= MIN_WIDTH;
	const finePointer = !window.matchMedia('(pointer: coarse)').matches;
	return wideEnough && finePointer;
}

function setupDeviceGate() {
	const gate = document.createElement('div');
	gate.id = 'deviceGate';
	gate.innerHTML =
		'<div class="deviceGateBox">' +
		'<h1>Desktop required</h1>' +
		'<p>This tool crops images against a pixel-accurate recreation of the Steam profile page, which needs a desktop or laptop with a mouse.</p>' +
		'<p>Please open this page on a computer with a browser window at least ' +
		MIN_WIDTH +
		'px wide.</p>' +
		'<p class="deviceGateMeta">Current window width: <span id="deviceGateWidth"></span>px' +
		'<span id="deviceGateTouch"></span></p>' +
		'</div>';
	document.body.appendChild(gate);

	const widthEl = document.getElementById('deviceGateWidth');
	const touchEl = document.getElementById('deviceGateTouch');

	function update() {
		const blocked = !isSupportedDevice();
		gate.classList.toggle('visible', blocked);
		widthEl.textContent = window.innerWidth;
		touchEl.textContent = window.matchMedia('(pointer: coarse)').matches
			? ' (touch input detected)'
			: '';
	}

	// Belt and suspenders: matchMedia's own change events and plain `resize`
	// both react instantly in normal browsers, but neither is guaranteed to
	// fire in every embedding context (devtools viewport emulation, some
	// in-app browsers), so a cheap periodic re-check backs them up - a
	// stuck gate (or a missed one) would otherwise be silent and easy to miss.
	const widthQuery = window.matchMedia(`(min-width: ${MIN_WIDTH}px)`);
	const pointerQuery = window.matchMedia('(pointer: coarse)');
	if (widthQuery.addEventListener) {
		widthQuery.addEventListener('change', update);
		pointerQuery.addEventListener('change', update);
	}
	window.addEventListener('resize', update);
	setInterval(update, 1000);
	update();
}

module.exports = setupDeviceGate;
