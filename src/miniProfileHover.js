// Shows/hides the Steam-style miniprofile popup on hover. Real Steam wires
// this up through its own account JS (InitMiniprofileHovers), which this
// page doesn't load, so it's reimplemented here as a plain hover toggle -
// the markup and styling still reuse Steam's own .miniprofile_* CSS.
function setupMiniProfileHover(targetSelector, popupSelector) {
	const target = document.querySelector(targetSelector);
	const popup = document.querySelector(popupSelector);
	if (!target || !popup) return;

	// The nameplate video is sized for a handful of hovers, not every page
	// load, so it's only fetched/played once the popup is actually shown.
	const video = popup.querySelector('video');

	target.addEventListener('mouseenter', function () {
		popup.classList.add('visible');
		if (video) video.play().catch(function () {});
	});
	target.addEventListener('mouseleave', function () {
		popup.classList.remove('visible');
		if (video) video.pause();
	});
}

module.exports = setupMiniProfileHover;
