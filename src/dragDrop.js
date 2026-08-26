// Lets people drop an image file anywhere on the page instead of only being
// able to click through the file picker. Reuses the existing file input's
// own change handling, so drag-and-drop is just an alternate way to fill it.
function setupDragAndDrop(inputSelector) {
	const input = document.querySelector(inputSelector);
	if (!input) return;

	let dragDepth = 0;
	const overlay = document.createElement('div');
	overlay.id = 'dragDropOverlay';
	overlay.textContent = 'Drop image to load it';
	document.body.appendChild(overlay);

	function showOverlay() {
		overlay.classList.add('visible');
	}

	function hideOverlay() {
		dragDepth = 0;
		overlay.classList.remove('visible');
	}

	function isFileDrag(event) {
		return (
			event.dataTransfer &&
			Array.from(event.dataTransfer.types || []).includes('Files')
		);
	}

	document.addEventListener('dragenter', function (event) {
		if (!isFileDrag(event)) return;
		event.preventDefault();
		dragDepth++;
		showOverlay();
	});

	document.addEventListener('dragover', function (event) {
		if (!isFileDrag(event)) return;
		event.preventDefault();
	});

	document.addEventListener('dragleave', function (event) {
		if (!isFileDrag(event)) return;
		dragDepth--;
		if (dragDepth <= 0) hideOverlay();
	});

	document.addEventListener('drop', function (event) {
		if (!isFileDrag(event)) return;
		event.preventDefault();
		hideOverlay();

		const files = event.dataTransfer.files;
		const t = files && files.length > 0 ? files[0].type : '';
		if (t.startsWith('image/') || t === 'video/webm' || t === 'video/mp4') {
			input.files = files;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		}
	});
}

module.exports = setupDragAndDrop;
