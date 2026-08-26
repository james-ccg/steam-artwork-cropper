// Lets people crop a background straight from its image link instead of
// downloading it and re-uploading it - fetches the bytes into a File the
// rest of the app can treat exactly like a local upload (same measuring,
// hexify, and export code paths; nothing downstream needs separate handling
// for a URL-sourced image vs. a picked one).
//
// Most of Steam's item-image CDN edges (community/cdn .cloudflare / .akamai)
// don't send CORS headers, so the browser blocks reading those bytes here
// even though the image loads fine as a plain <img>. But the
// `shared.fastly.steamstatic.com/community_assets/...` edge - which serves
// both the animated-background `.webm` files and their `.jpg` posters - does
// send `Access-Control-Allow-Origin: *`, so rewriting the host to that one
// makes an animated background from the Backgrounds gallery directly
// loadable. Anything still on a blocked host gets a save-and-upload hint.
const CORS_HOST_REWRITE = {
	'shared.cloudflare.steamstatic.com': 'shared.fastly.steamstatic.com',
	'shared.akamai.steamstatic.com': 'shared.fastly.steamstatic.com',
};
const KNOWN_CORS_BLOCKED_HOSTS = [
	'community.cloudflare.steamstatic.com',
	'cdn.cloudflare.steamstatic.com',
	'community.akamai.steamstatic.com',
	'steamcdn-a.akamaihd.net',
	'community.fastly.steamstatic.com',
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

	if (CORS_HOST_REWRITE[parsed.hostname]) {
		parsed.hostname = CORS_HOST_REWRITE[parsed.hostname];
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
	const isImage = blob.type && blob.type.startsWith('image/');
	const isBgVideo = blob.type === 'video/webm' || blob.type === 'video/mp4';
	if (blob.type && !isImage && !isBgVideo) {
		throw new Error('that link is not a direct image or video link');
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
