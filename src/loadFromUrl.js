// Lets people crop a background straight from its image link instead of
// downloading it and re-uploading it - fetches the bytes into a File the
// rest of the app can treat exactly like a local upload (same measuring,
// hexify, and export code paths; nothing downstream needs separate handling
// for a URL-sourced image vs. a picked one).
//
// Steam's own background/item-image CDN (community.cloudflare.steamstatic.com,
// cdn.cloudflare.steamstatic.com) does not send CORS headers, so the browser
// blocks reading those bytes here even though the image loads fine as a plain
// <img> - this is a restriction on Steam's server, not something a client-side
// tool can work around. Other hosts (Steam's own avatar CDN, imgur, Discord's
// CDN, etc.) generally do allow it. Rather than fail with a generic network
// error for the single most common case, this recognises the blocked hosts
// up front and tells people to save-and-upload instead.
const KNOWN_CORS_BLOCKED_HOSTS = [
	'community.cloudflare.steamstatic.com',
	'cdn.cloudflare.steamstatic.com',
	'community.akamai.steamstatic.com',
	'steamcdn-a.akamaihd.net',
	'community.fastly.steamstatic.com',
	'shared.fastly.steamstatic.com',
	'shared.cloudflare.steamstatic.com',
	'shared.akamai.steamstatic.com',
];

async function fetchImageAsFile(url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch (e) {
		throw new Error('not a valid URL');
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		throw new Error('not a valid URL');
	}

	let response;
	try {
		response = await fetch(parsed.href, { mode: 'cors' });
	} catch (e) {
		if (KNOWN_CORS_BLOCKED_HOSTS.includes(parsed.hostname)) {
			throw new Error(
				"Steam's background CDN blocks this (CORS) - right-click the image, Save As, then use the file picker above instead"
			);
		}
		throw new Error(
			"couldn't fetch that link (blocked by CORS, or the link is down)"
		);
	}
	if (!response.ok) throw new Error(`server responded ${response.status}`);

	const blob = await response.blob();
	if (blob.type && !blob.type.startsWith('image/')) {
		throw new Error('that link is not a direct image link');
	}

	const nameFromUrl = decodeURIComponent(
		parsed.pathname.split('/').filter(Boolean).pop() || 'background'
	);
	const hasExtension = /\.\w+$/.test(nameFromUrl);
	const extension = (blob.type || 'image/jpeg').split('/')[1] || 'jpg';
	const filename = hasExtension ? nameFromUrl : `${nameFromUrl}.${extension}`;

	return new File([blob], filename, { type: blob.type || 'image/jpeg' });
}

module.exports = { fetchImageAsFile };
