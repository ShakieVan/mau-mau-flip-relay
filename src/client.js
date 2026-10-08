// Mau-Mau Flip – Browser-Client über den Vermittler (docs/online/ENTWURF.md, Abschnitt 4).
// /c/<version>/<datei> kommt aus dem Quell-Repo am Tag v<version>: https://raw.githubusercontent.com/<repo>/v<version>/webclient/<datei>
// (Rückfall bei 429/5xx/Netzfehler: jsDelivr, derselbe Tag). So holt sich jeder Vermittler den Client jeder App-Version selbst;
// niemand muss ihn nach einem Update neu bereitstellen. Ein Tag ändert sich nicht → lange Zwischenspeicherung (Cloudflare und Browser).
// Reines ES-Modul: fetch und Cache werden eingespritzt (relay/test/core.test.js prüft es in Chrome headless).

export const DEFAULT_REPO = 'ShakieVan/Mau-Mau-Flip'
export const CLIENT_DIR = 'webclient'
export const YEAR_S = 31536000
export const MISSING_S = 300      // 404 nur kurz merken: der Tag kann nach dem Release noch kommen

const TYPES = {
	html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
	css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8',
	svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', ico: 'image/x-icon',
	woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
	mp4: 'video/mp4', m4a: 'audio/mp4', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav',
	wasm: 'application/wasm', pck: 'application/octet-stream',   // für den späteren Godot-Web-Client
}

export function validClientVersion(v) { return typeof v === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v) }

export function contentType(file) {
	const m = /\.([a-z0-9]+)$/i.exec(file || '')
	return m ? TYPES[m[1].toLowerCase()] || '' : ''
}

// Dateipfad: nur [A-Za-z0-9_./-], kein „..“, keine leeren Teile, kein Teil mit Punkt am Anfang, bekannte Endung.
export function validClientFile(f) {
	if (typeof f !== 'string' || f.length < 1 || f.length > 200 || !/^[A-Za-z0-9_./-]+$/.test(f) || f.includes('..')) return false
	if (f.split('/').some(p => p === '' || p.startsWith('.'))) return false
	return contentType(f) !== ''
}

export function clientRepo(env) {
	const r = env && typeof env.CLIENT_REPO === 'string' ? env.CLIENT_REPO.trim() : ''
	return /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(r) && !r.includes('..') ? r : DEFAULT_REPO
}

export function sourceUrls(repo, version, file) {
	return [
		'https://raw.githubusercontent.com/' + repo + '/v' + version + '/' + CLIENT_DIR + '/' + file,
		'https://cdn.jsdelivr.net/gh/' + repo + '@v' + version + '/' + CLIENT_DIR + '/' + file,
	]
}

// Pfad → {kind:'file', version, file} | {kind:'slash', version} (ohne Schrägstrich am Ende) | {kind:'bad'} | null (nicht /c/)
export function parseClientPath(pathname) {
	if (pathname !== '/c' && !pathname.startsWith('/c/')) return null
	let rest = pathname.slice(3)
	try { rest = decodeURIComponent(rest) } catch (e) { return { kind: 'bad' } }
	const slash = rest.indexOf('/')
	const version = slash < 0 ? rest : rest.slice(0, slash)
	if (!validClientVersion(version)) return { kind: 'bad' }
	if (slash < 0) return { kind: 'slash', version }
	const file = rest.slice(slash + 1) || 'index.html'
	return validClientFile(file) ? { kind: 'file', version, file } : { kind: 'bad' }
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }

// Zweisprachige Fehlerseite. why: 'version' (Client dieser Version fehlt), 'file' (Datei fehlt), 'bad' (ungültiger Pfad), 'source' (Quelle nicht erreichbar)
export function errorPage(why, version, file, repo) {
	const v = esc(version || ''), f = esc(file || ''), r = esc(repo || DEFAULT_REPO)
	const de = {
		version: `Für die Spielversion <b>${v}</b> gibt es im Quell-Repo <b>${r}</b> keinen Browser-Client (Tag <code>v${v}</code> fehlt). Meist ist das eine Test- oder Eigenbau-Version des Gastgebers. Der Gastgeber kann auf eine veröffentlichte Version aktualisieren; Mitspieler mit der App können trotzdem beitreten.`,
		file: `Die Datei <code>${f}</code> des Browser-Clients ${v} gibt es nicht.`,
		bad: 'Diese Adresse ist ungültig.',
		source: `Der Browser-Client ${v} lässt sich gerade nicht von GitHub laden. Bitte gleich noch einmal versuchen.`,
	}
	const en = {
		version: `The source repository <b>${r}</b> has no browser client for game version <b>${v}</b> (tag <code>v${v}</code> is missing). This is usually a test or self-built version of the host. The host can update to a published version; players with the app can still join.`,
		file: `The file <code>${f}</code> of browser client ${v} does not exist.`,
		bad: 'This address is not valid.',
		source: `The browser client ${v} cannot be loaded from GitHub right now. Please try again in a moment.`,
	}
	return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Mau-Mau Flip</title>
<style>
:root{--bg:#f6f0e4;--ink:#2a2230;--accent:#e0457b}
@media (prefers-color-scheme:dark){:root{--bg:#141428;--ink:#ece6ff;--accent:#4fe3d0}}
html,body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:32rem;margin:0 auto;padding:2rem 16px}a{color:var(--accent);font-weight:600}code{word-break:break-all}
</style></head><body><main>
<h1>Mau-Mau Flip</h1>
<p lang="de">${de[why] || de.bad} <a href="/">Zur Startseite</a></p>
<p lang="en">${en[why] || en.bad} <a href="/">Go to the start page</a></p>
</main></body></html>
`
}

function page(why, status, version, file, repo, head) {
	return new Response(head ? null : errorPage(why, version, file, repo), { status, headers: {
		'content-type': 'text/html; charset=utf-8', 'cache-control': status === 404 ? 'public, max-age=' + MISSING_S : 'no-store',
		'x-content-type-options': 'nosniff' } })
}

// Antwort für /c/*. deps: {fetch, cache (caches.default oder null), waitUntil(promise)}; env.CLIENT_REPO stellt die Quelle um.
export async function serveClient(req, env, deps) {
	const url = new URL(req.url)
	const p = parseClientPath(url.pathname)
	const repo = clientRepo(env)
	const head = req.method === 'HEAD'
	if (!p || p.kind === 'bad') return page('bad', 404, '', '', repo, head)
	if (req.method !== 'GET' && !head) return new Response('method', { status: 405, headers: { allow: 'GET, HEAD' } })
	if (p.kind === 'slash') return new Response(null, { status: 301, headers: { location: '/c/' + p.version + '/' + url.search } })
	const range = req.headers && req.headers.get ? req.headers.get('range') : null
	const key = new Request(url.origin + '/c/' + p.version + '/' + p.file)
	const cache = deps.cache || null
	if (cache && !range) {
		try {
			const hit = await cache.match(key)
			if (hit) return head ? new Response(null, { status: hit.status, headers: hit.headers }) : hit
		} catch (e) { }
	}
	let up = null
	for (const src of sourceUrls(repo, p.version, p.file)) {
		try {
			up = await deps.fetch(src, {
				headers: range ? { range } : {},
				cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': YEAR_S, '404': MISSING_S, '500-599': 0 } },
			})
		} catch (e) { up = null }
		if (up && (up.ok || up.status === 404)) break
	}
	if (!up) return page('source', 502, p.version, p.file, repo, head)
	if (up.status === 404) return page(p.file === 'index.html' ? 'version' : 'file', 404, p.version, p.file, repo, head)
	if (!up.ok) return page('source', 502, p.version, p.file, repo, head)
	// Eigene Köpfe statt der von GitHub (dort text/plain, nosniff, CSP sandbox).
	const h = new Headers({ 'content-type': contentType(p.file), 'cache-control': 'public, max-age=' + YEAR_S + ', immutable',
		'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes' })
	for (const k of ['content-range', 'etag', 'last-modified']) { const v = up.headers.get(k); if (v) h.set(k, v) }
	const body = await up.arrayBuffer()
	if (up.status === 200 && cache) {
		try {
			const put = cache.put(key, new Response(body.slice(0), { status: 200, headers: h }))
			if (deps.waitUntil) deps.waitUntil(put); else await put
		} catch (e) { }
	}
	return new Response(head ? null : body, { status: up.status, headers: h })
}
