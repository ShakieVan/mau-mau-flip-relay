// Mau-Mau Flip – Tests des Vermittlers in Chrome headless (ohne Node): Kern gegen relay/test/vectors.json, Wortliste,
// Raumcodes, Lader der Startseite und der Klebstoff in worker.js (mit Ersatz für die Cloudflare-Umgebung).
// Ergebnis: window.__result = {ok, fail, lines}; window.__done = true. Aufruf siehe tools/build.ps1 (Invoke-RelayTest).

import { RelayRoom, normalizeCode, newCode, codeCount, utf8Length, LIMITS, CLOSE } from '../src/core.js'
import { WORDS, FORBIDDEN } from '../src/words.js'
import { looseCode, decide, lang, TEXTS } from '../public/loader.js'
import { serveClient, parseClientPath, validClientFile, contentType, clientRepo, sourceUrls, errorPage, DEFAULT_REPO, YEAR_S } from '../src/client.js'

const lines = []
let ok = 0, fail = 0
function check(cond, what) { if (cond) ok++; else { fail++; lines.push('FAIL: ' + what) } }
function eq(a, b, what) { check(JSON.stringify(a) === JSON.stringify(b), what + ' – erwartet ' + JSON.stringify(b) + ', erhalten ' + JSON.stringify(a)) }

// Teilmenge: alle Schlüssel von exp kommen mit gleichem Wert in got vor (Objekte rekursiv, Listen genau).
function subset(exp, got) {
	if (exp === null || typeof exp !== 'object' || Array.isArray(exp)) return JSON.stringify(exp) === JSON.stringify(got)
	if (got === null || typeof got !== 'object') return false
	return Object.keys(exp).every(k => subset(exp[k], got[k]))
}

// ---------- Umgebung wie im Durable Object, aber im Speicher ----------
function makeEnv(vectors) {
	const st = { list: [], out: [], store: new Map(), alarm: null, now: 0 }
	st.env = {
		now: () => st.now,
		accept: (ws, tags) => { ws.tags = tags; st.list.push(ws) },
		sockets: (tag) => st.list.filter(w => !tag || w.tags.includes(tag)),
		send: (ws, text) => st.out.push({ to: ws.name, text }),
		close: (ws, code) => { st.out.push({ to: ws.name, close: code }); st.list = st.list.filter(w => w !== ws) },
		attach: (ws, obj) => { ws.att = JSON.parse(JSON.stringify(obj)) },   // wie serializeAttachment: Kopie
		getAttach: (ws) => ws.att ? JSON.parse(JSON.stringify(ws.att)) : null,
		storage: {
			get: async (k) => st.store.has(k) ? JSON.parse(st.store.get(k)) : undefined,
			put: async (k, v) => { st.store.set(k, JSON.stringify(v)) },
			deleteAll: async () => { st.store.clear() },
		},
		setAlarm: async (t) => { st.alarm = t },
		deleteAlarm: async () => { st.alarm = null },
		token: () => vectors.token,
	}
	return st
}

function matchOutputs(out, expect, sockets, what) {
	const flat = []
	for (const e of expect) for (let i = 0; i < (e.times || 1); i++) flat.push(e)
	if (out.length !== flat.length) {
		check(false, what + ': ' + out.length + ' Ausgaben statt ' + flat.length + ' – ' + JSON.stringify(out.slice(0, 6)))
		return
	}
	for (let i = 0; i < flat.length; i++) {
		const e = flat[i], o = out[i]
		let good = o.to === e.to
		if ('close' in e) good = good && o.close === e.close
		else if ('text' in e) good = good && o.text === e.text
		else {
			let f = null
			try { f = JSON.parse(o.text) } catch (x) { }
			good = good && f !== null && subset(e.frame, f) && (e.absent || []).every(k => !(k in f))
		}
		if (!good) { check(false, what + ' Ausgabe ' + i + ': erwartet ' + JSON.stringify(e) + ', erhalten ' + JSON.stringify(o)); return }
	}
	check(true, what)
}

async function runCase(vectors, c) {
	const st = makeEnv(vectors)
	const room = new RelayRoom(st.env)
	const socks = {}
	let n = 0
	for (const s of c.steps) {
		n++
		const what = c.name + ' #' + n + ' ' + s.do + (s.as ? ' ' + s.as : '')
		if (typeof s.t === 'number') st.now = s.t
		st.out = []
		if (s.do === 'connect') {
			const ws = { name: s.as, tags: [], att: null }
			let made = false
			const q = { ...s.q, origin: vectors.origin, agent: s.q.agent || '' }
			const res = await room.open(q, () => { made = true; return ws })
			if (s.http) { eq(res.status, s.http, what + ' HTTP'); check(!made, what + ' ohne Socket') }
			else { eq(res.status, 101, what + ' angenommen'); socks[s.as] = ws }
		} else if (s.do === 'text') {
			const data = s.fill ? 'x'.repeat(s.fill) : s.text
			for (let i = 0; i < (s.repeat || 1); i++) await room.message(socks[s.as], data)
		} else if (s.do === 'frame') {
			await room.message(socks[s.as], JSON.stringify(s.frame))
		} else if (s.do === 'close') {
			const ws = socks[s.as]
			await room.closed(ws, s.code)
			st.list = st.list.filter(w => w !== ws)
		} else if (s.do === 'alarm') {
			await room.alarm()
		} else if (s.do === 'info') {
			const info = await room.info()
			check(subset(s.info, info), what + ' – erwartet ' + JSON.stringify(s.info) + ', erhalten ' + JSON.stringify(info))
		} else check(false, what + ': unbekannter Schritt')
		matchOutputs(st.out, s.expect || [], socks, what)
		if ('alarm' in s) eq(st.alarm, s.alarm, what + ' Alarm')
		if ('stored' in s) eq(st.store.has('meta'), s.stored, what + ' Speicher')
	}
}

// ---------- Wortliste und Codes ----------
function testWords() {
	check(WORDS.length >= 180 && WORDS.length <= 260, 'Wortliste ~200 (' + WORDS.length + ')')
	eq(new Set(WORDS).size, WORDS.length, 'Wortliste ohne Doppelte')
	for (const w of WORDS) {
		check(/^[A-Z]{3,6}$/.test(w), 'Wort 3–6 Buchstaben A–Z: ' + w)
		for (const f of FORBIDDEN) check(!w.includes(f), 'Wort ' + w + ' enthält verbotenes Teilwort ' + f)
		eq(normalizeCode(w.toLowerCase() + ' 55'), w + '-55', 'normalizeCode ' + w)
	}
	check(codeCount() >= 16000, 'genug Codes (' + codeCount() + ')')
}

function testCodes(vectors) {
	for (const [input, want] of vectors.codes) {
		eq(normalizeCode(input), want, 'normalizeCode(' + JSON.stringify(input) + ')')
		if (want) eq(looseCode(input), want, 'looseCode(' + JSON.stringify(input) + ')')
	}
	eq(newCode(() => 0), WORDS[0] + '-10', 'newCode kleinster')
	eq(newCode(() => 0.999999), WORDS[WORDS.length - 1] + '-99', 'newCode größter')
	for (let i = 0; i < 200; i++) { const c = newCode(); check(normalizeCode(c) === c, 'newCode gültig ' + c) }
	eq(utf8Length('aÄ€😀'), 1 + 2 + 3 + 4, 'utf8Length')
	eq(normalizeCode(123), '', 'normalizeCode ohne Text')
}

function testLoader() {
	eq(decide(null, ''), { action: 'ask' }, 'Lader ohne Code')
	eq(decide({ room: { open: false } }, 'KATZE-42').why, 'no_room', 'Lader Raum fehlt')
	eq(decide(null, 'KATZE-42').why, 'no_room', 'Lader ohne Antwort')
	const go = decide({ source: { repo: 'a/b' }, room: { open: true, host: true, version: '1.2.2' } }, 'KATZE-42')
	eq([go.action, go.url, go.host], ['go', '/c/1.2.2/?r=KATZE-42', true], 'Lader leitet zur Version des Gastgebers (ohne Versionsliste)')
	eq(decide({ versions: ['1.2.2'], room: { open: true, version: '9.9.9' } }, 'KATZE-42').url, '/c/9.9.9/?r=KATZE-42', 'Lader: jede Version, alte Liste egal')
	for (const bad of ['', '1.2', '1.2.3-beta', '../1.2.3', '1.2.3/x'])
		eq([decide({ room: { open: true, version: bad } }, 'KATZE-42').why], ['version'], 'Lader ungültige Version ' + JSON.stringify(bad))
	for (const l of ['de', 'en']) check(TEXTS[l].version.includes('{v}') && !/sync/i.test(JSON.stringify(TEXTS[l])), 'Lader-Text ' + l + ' ohne „Sync fork“')
	eq([lang('de-DE'), lang('en-US'), lang('')], ['de', 'en', 'en'], 'Lader Sprache')
	eq(looseCode('ab'), '', 'looseCode ungültig')
}

// ---------- Browser-Client aus dem Quell-Repo (client.js) mit eingespritztem fetch und Cache ----------
async function testClient() {
	eq(parseClientPath('/c/1.3.1/'), { kind: 'file', version: '1.3.1', file: 'index.html' }, 'Pfad /c/<v>/ → index.html')
	eq(parseClientPath('/c/1.3.1/cards/hell_rot_5.webp'), { kind: 'file', version: '1.3.1', file: 'cards/hell_rot_5.webp' }, 'Pfad mit Unterordner')
	eq(parseClientPath('/c/1.3.1'), { kind: 'slash', version: '1.3.1' }, 'Pfad ohne Schrägstrich')
	eq(parseClientPath('/info'), null, 'Pfad außerhalb /c/')
	for (const bad of ['/c/', '/c/1.3/', '/c/v1.3.1/', '/c/1.3.1-beta/', '/c/../x', '/c/1.3.1/../x.js', '/c/1.3.1/a/../b.js', '/c/1.3.1/%2e%2e/x.js',
		'/c/1.3.1/a//b.js', '/c/1.3.1/.git/config', '/c/1.3.1/x.exe', '/c/1.3.1/a b.js', '/c/1.3.1/x%3F.js', '/c/1.3.1/%E0%A4%A.js', '/c/1.3.1/README'])
		eq(parseClientPath(bad), { kind: 'bad' }, 'Pfad abgelehnt ' + bad)
	check(!validClientFile('x'.repeat(198) + '.js'), 'Dateipfad zu lang')
	eq([contentType('a.html'), contentType('a.JS'), contentType('a.css'), contentType('a.json'), contentType('a.svg'), contentType('a.png'),
		contentType('a.webp'), contentType('a.woff2'), contentType('a.ttf'), contentType('a.m4a'), contentType('a.ogg'), contentType('a.mp4'), contentType('a.wasm')],
		['text/html; charset=utf-8', 'text/javascript; charset=utf-8', 'text/css; charset=utf-8', 'application/json; charset=utf-8', 'image/svg+xml', 'image/png',
			'image/webp', 'font/woff2', 'font/ttf', 'audio/mp4', 'audio/ogg', 'video/mp4', 'application/wasm'], 'Content-Types')
	eq([clientRepo({}), clientRepo({ CLIENT_REPO: ' Fork/Repo ' }), clientRepo({ CLIENT_REPO: 'a/b/c' }), clientRepo({ CLIENT_REPO: 'x/..' }), clientRepo(null)],
		[DEFAULT_REPO, 'Fork/Repo', DEFAULT_REPO, DEFAULT_REPO, DEFAULT_REPO], 'CLIENT_REPO geprüft, Standard ShakieVan/Mau-Mau-Flip')
	eq(sourceUrls('A/B', '1.2.3', 'x/y.js'), ['https://raw.githubusercontent.com/A/B/v1.2.3/webclient/x/y.js', 'https://cdn.jsdelivr.net/gh/A/B@v1.2.3/webclient/x/y.js'], 'Quell-Adressen')
	check(/Spielversion <b>1\.2\.3<\/b>/.test(errorPage('version', '1.2.3', 'index.html', 'A/B')) && /game version <b>1\.2\.3<\/b>/.test(errorPage('version', '1.2.3', '', 'A/B')), 'Fehlerseite zweisprachig')
	check(!errorPage('file', '<x>', '"&', 'A/B').includes('<x>'), 'Fehlerseite maskiert')

	// Schein-GitHub: Tag v1.3.1 vorhanden, v9.9.9 nicht; Zähler je Adresse
	const files = { 'index.html': '<!doctype html>hallo', 'app.js': 'console.log(1)', 'wach.mp4': '0123456789' }
	const calls = []
	let mode = 'ok'
	const fakeFetch = async (u, init) => {
		calls.push({ u, init })
		if (mode === 'down') throw new Error('offline')
		if (mode === 'raw429' && u.startsWith('https://raw.')) return new Response('slow down', { status: 429 })
		if (mode === '500') return new Response('x', { status: 500 })
		const m = /\/v?(\d+\.\d+\.\d+)\/webclient\/(.+)$/.exec(u.replace('@v', '/v'))
		if (!m || m[1] !== '1.3.1' || !(m[2] in files)) return new Response('404: Not Found', { status: 404, headers: { 'content-type': 'text/plain' } })
		const range = init && init.headers && init.headers.range
		if (range) return new Response(files[m[2]].slice(0, 4), { status: 206, headers: { 'content-range': 'bytes 0-3/10' } })
		return new Response(files[m[2]], { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'set-cookie': 'x=1', 'content-security-policy': "default-src 'none'; sandbox", etag: '"e1"' } })
	}
	const store = new Map()
	const cache = { match: async (k) => store.has(k.url) ? store.get(k.url).clone() : undefined, put: async (k, r) => { store.set(k.url, r) } }
	const waits = []
	const deps = { fetch: fakeFetch, cache, waitUntil: (p) => waits.push(p) }
	const get = (path, headers = {}, method = 'GET') => serveClient(new Request('https://relay.test' + path, { method, headers }), { CLIENT_REPO: 'ShakieVan/Mau-Mau-Flip' }, deps)

	let r = await get('/c/1.3.1/?r=KATZE-42')
	eq([r.status, r.headers.get('content-type'), r.headers.get('cache-control'), r.headers.get('set-cookie'), r.headers.get('content-security-policy'), await r.text()],
		[200, 'text/html; charset=utf-8', 'public, max-age=' + YEAR_S + ', immutable', null, null, '<!doctype html>hallo'], 'index.html mit eigenen Köpfen')
	eq(calls.map(c => c.u), ['https://raw.githubusercontent.com/ShakieVan/Mau-Mau-Flip/v1.3.1/webclient/index.html'], 'eine Anfrage an GitHub')
	check(calls[0].init.cf && calls[0].init.cf.cacheEverything === true && calls[0].init.cf.cacheTtlByStatus['200-299'] === YEAR_S, 'fetch mit cf-Zwischenspeicher')
	await Promise.all(waits)
	eq(store.has('https://relay.test/c/1.3.1/index.html'), true, 'im Cache abgelegt (ohne Suchteil)')
	calls.length = 0
	r = await get('/c/1.3.1/index.html')
	eq([r.status, await r.text(), calls.length], [200, '<!doctype html>hallo', 0], 'zweiter Abruf aus dem Cache')
	r = await get('/c/1.3.1/app.js', {}, 'HEAD')
	eq([r.status, r.headers.get('content-type'), await r.text()], [200, 'text/javascript; charset=utf-8', ''], 'HEAD ohne Körper')
	calls.length = 0
	r = await get('/c/1.3.1/wach.mp4', { range: 'bytes=0-3' })
	eq([r.status, r.headers.get('content-range'), await r.text(), calls[0].init.headers.range], [206, 'bytes 0-3/10', '0123', 'bytes=0-3'], 'Range wird durchgereicht')
	eq(store.has('https://relay.test/c/1.3.1/wach.mp4'), false, 'Teilantwort nicht im Cache')
	r = await get('/c/9.9.9/?r=KATZE-42')
	let t = await r.text()
	eq([r.status, r.headers.get('cache-control')], [404, 'public, max-age=300'], 'fehlende Version: 404, kurz gemerkt')
	check(t.includes('v9.9.9') && t.includes('lang="de"') && t.includes('lang="en"') && t.includes('ShakieVan/Mau-Mau-Flip'), 'fehlende Version: zweisprachige Erklärung')
	eq(store.has('https://relay.test/c/9.9.9/index.html'), false, '404 nicht im Cache-API')
	r = await get('/c/1.3.1/fehlt.js')
	check(r.status === 404 && (await r.text()).includes('fehlt.js'), 'fehlende Datei: 404 mit Dateiname')
	r = await get('/c/1.3.1/../../etc/passwd.js')
	eq(r.status, 404, 'Ausbruch abgelehnt')
	calls.length = 0
	r = await get('/c/1.3.1/%2e%2e/x.js')
	eq([r.status, calls.length], [404, 0], 'kodierter Ausbruch ohne Abruf')
	r = await get('/c/1.3.1/app.js', {}, 'POST')
	eq(r.status, 405, 'nur GET/HEAD')
	mode = 'raw429'; calls.length = 0; store.clear()
	r = await get('/c/1.3.1/app.js')
	eq([r.status, await r.text(), calls.map(c => c.u.split('/')[2])], [200, 'console.log(1)', ['raw.githubusercontent.com', 'cdn.jsdelivr.net']], 'Rückfall auf jsDelivr bei 429')
	mode = 'down'; store.clear()
	r = await get('/c/1.3.1/app.js')
	check(r.status === 502 && r.headers.get('cache-control') === 'no-store', 'GitHub nicht erreichbar: 502, nicht gemerkt')
	mode = '500'
	eq((await get('/c/1.3.1/app.js')).status, 502, 'GitHub 500: 502')
	mode = 'ok'
	r = await serveClient(new Request('https://relay.test/c/1.3.1/app.js'), {}, { fetch: fakeFetch, cache: null })
	eq([r.status, await r.text()], [200, 'console.log(1)'], 'ohne Cache-API (workers.dev) und ohne CLIENT_REPO')
	const throwing = { match: async () => { throw new Error('x') }, put: () => { throw new Error('x') } }
	r = await serveClient(new Request('https://relay.test/c/1.3.1/app.js'), {}, { fetch: fakeFetch, cache: throwing })
	eq(r.status, 200, 'Cache-Fehler stören nicht')
}

// ---------- Klebstoff worker.js mit Ersatz-Umgebung ----------
async function testWorker() {
	globalThis.WebSocketRequestResponsePair = class { constructor(a, b) { this.request = a; this.response = b } }
	const mod = await import('../src/worker.js')
	const worker = mod.default
	const calls = []
	let answers = []
	const env = {
		ASSETS: { fetch: async () => new Response('asset') },
		CLIENT_REPO: 'Fork/Mau-Mau-Flip',
		ROOMS: {
			idFromName: (n) => 'id:' + n,
			get: (id) => ({ fetch: async (r) => {
				const u = new URL(r.url); calls.push({ id, path: u.pathname, q: Object.fromEntries(u.searchParams) })
				if (u.pathname === '/info') return new Response(JSON.stringify({ open: true, host: true, version: '1.2.2' }))
				const s = answers.length ? answers.shift() : 200
				return new Response('x', { status: s })
			} }),
		},
	}
	const req = (path, headers = {}) => ({ url: 'https://relay.test' + path, headers: new Headers(headers) })
	const up = { Upgrade: 'websocket', 'User-Agent': 'Testgerät' }
	let r = await worker.fetch(req('/info'), env)
	eq(await r.json(), { game: 'mau-mau-flip', relay: 2, proto: 1,
		source: { repo: 'Fork/Mau-Mau-Flip', url: 'https://github.com/Fork/Mau-Mau-Flip', dir: 'webclient', tag: 'v<version>' } }, 'Worker /info mit Quelle statt Versionsliste')
	r = await worker.fetch(req('/info?room=katze%2042'), env)
	eq((await r.json()).room, { open: true, host: true, version: '1.2.2', code: 'KATZE-42' }, 'Worker /info?room')
	eq(calls.pop().id, 'id:KATZE-42', 'Worker /info?room fragt das Objekt des normalisierten Codes')
	r = await worker.fetch(req('/info?room=QQQ-1'), env)
	eq((await r.json()).room, { open: false }, 'Worker /info ungültiger Code ohne Objekt-Aufruf')
	eq(calls.length, 0, 'kein Objekt-Aufruf bei ungültigem Code')
	eq((await worker.fetch(req('/ws?role=guest&room=KATZE-42'), env)).status, 426, 'Worker /ws ohne Upgrade')
	eq((await worker.fetch(req('/ws?role=zz&room=KATZE-42', up), env)).status, 400, 'Worker /ws falsche Rolle')
	eq((await worker.fetch(req('/ws?role=guest&room=nix', up), env)).status, 400, 'Worker /ws falscher Code')
	eq((await worker.fetch(req('/ws?role=host&room=KATZE-42&token=abc', up), env)).status, 400, 'Worker /ws falscher Token')
	eq((await worker.fetch(req('/ws?role=host&v=1.2.2&proto=2', up), env)).status, 400, 'Worker /ws falsches proto')
	eq((await worker.fetch(req('/ws?role=host&v=', up), env)).status, 400, 'Worker /ws ohne Version')
	r = await worker.fetch(req('/ws?role=guest&room=Katze-42', up), env)
	let c = calls.pop()
	eq([r.status, c.id, c.q.role, c.q.room, c.q.agent, c.q.token], [200, 'id:KATZE-42', 'guest', 'KATZE-42', 'Testgerät', undefined], 'Worker leitet Gast weiter')
	calls.length = 0
	answers = [409, 409, 200]
	r = await worker.fetch(req('/ws?role=host&v=1.2.2&proto=1', up), env)
	eq([r.status, calls.length], [200, 3], 'Worker würfelt neu, solange belegt')
	check(calls.every(x => normalizeCode(x.q.room) === x.q.room && x.q.create === '1' && x.q.v === '1.2.2' && x.id === 'id:' + x.q.room), 'Worker: gültige Codes beim Anlegen')
	calls.length = 0
	answers = Array(8).fill(409)
	r = await worker.fetch(req('/ws?role=host&v=1.2.2', up), env)
	eq([r.status, calls.length], [503, 8], 'Worker gibt nach 8 Versuchen auf')
	r = await worker.fetch(req('/'), env)
	eq(await r.text(), 'asset', 'Worker: alles andere aus den Assets')
	// /c/* über den Worker: globales fetch kurz ersetzen (der Worker reicht es an client.js weiter)
	const realFetch = globalThis.fetch
	const seen = []
	globalThis.fetch = async (u) => { seen.push(String(u)); return new Response('<!doctype html>client', { status: 200, headers: { 'content-type': 'text/plain' } }) }
	try {
		r = await worker.fetch(new Request('https://relay.test/c/1.3.1/?r=KATZE-42'), env, { waitUntil: () => { } })
		eq([r.status, r.headers.get('content-type'), await r.text()], [200, 'text/html; charset=utf-8', '<!doctype html>client'], 'Worker /c/<version>/ → index.html aus dem Quell-Repo')
		eq(seen, ['https://raw.githubusercontent.com/Fork/Mau-Mau-Flip/v1.3.1/webclient/index.html'], 'Worker nutzt CLIENT_REPO')
		r = await worker.fetch(new Request('https://relay.test/c/1.3.1?r=KATZE-42'), env)
		eq([r.status, r.headers.get('location')], [301, '/c/1.3.1/?r=KATZE-42'], 'Worker /c/<version> ohne Schrägstrich → weiter')
		eq(seen.length, 1, 'Weiterleitung ohne Abruf')
	} finally { globalThis.fetch = realFetch }
	// Raum-Klasse mit Ersatz-ctx
	let auto = null
	const ctx = {
		setWebSocketAutoResponse: (p) => { auto = p }, acceptWebSocket: () => { }, getWebSockets: () => [],
		storage: { get: async () => undefined, put: async () => { }, deleteAll: async () => { }, setAlarm: async () => { }, deleteAlarm: async () => { } },
	}
	const room = new mod.Room(ctx, {})
	eq([auto && auto.request, auto && auto.response], ['ping', 'pong'], 'Room: Auto-Antwort ping/pong')
	r = await room.fetch(new Request('https://relay.test/info'))
	eq(await r.json(), { open: false }, 'Room /info ohne Raum')
}

async function main() {
	try {
		const vectors = await (await fetch('./vectors.json', { cache: 'no-store' })).json()
		testWords()
		testCodes(vectors)
		testLoader()
		for (const c of vectors.cases) await runCase(vectors, c)
		check(LIMITS.guests === 16 && LIMITS.msg === 8192 && CLOSE.HOST_AWAY === 4503, 'Grenzen wie im Entwurf')
		await testClient()
		await testWorker()
	} catch (e) {
		fail++
		lines.push('AUSNAHME: ' + (e && e.stack || e))
	}
	window.__result = { ok, fail, lines: lines.slice(0, 40) }
	document.getElementById('out').textContent = (fail ? 'FEHLER' : 'OK') + ' ' + ok + ' ok, ' + fail + ' Fehler\n' + lines.join('\n')
	window.__done = true
}
main()
