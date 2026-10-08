// Mau-Mau Flip – Vermittler als Cloudflare Worker (docs/online/ENTWURF.md). Nur Klebstoff: Routing von /ws, /info und /c/*
// (run_worker_first), Raumcode würfeln, Durable-Object-Klasse Room mit Hibernation-API. Die Logik steckt in core.js und client.js
// (in Chrome headless getestet). /c/<version>/… holt den Browser-Client aus dem Quell-Repo (Variable CLIENT_REPO, client.js);
// alles andere (Lader „/“, 404.html) liefert die Asset-Bindung ASSETS kostenlos aus.
// Keine Protokollierung von Inhalten, Raumcodes oder Tokens.

import { DurableObject } from 'cloudflare:workers'
import { RelayRoom, RELAY_VERSION, PROTO, normalizeCode, newCode, validToken, validVersion } from './core.js'
import { serveClient, clientRepo, CLIENT_DIR } from './client.js'

const CREATE_TRIES = 8
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }

function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS }) }
function text(body, status) { return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } }) }

function cryptoRandom() {
	const a = new Uint32Array(1)
	crypto.getRandomValues(a)
	return a[0] / 4294967296
}

// Quelle des Browser-Clients statt einer Versionsliste: jede veröffentlichte Version (Tag v<version>) ist verfügbar.
function source(env) {
	const repo = clientRepo(env)
	return { repo, url: 'https://github.com/' + repo, dir: CLIENT_DIR, tag: 'v<version>' }
}

function defaultCache() {
	try { return typeof caches !== 'undefined' && caches.default ? caches.default : null } catch (e) { return null }
}

function roomStub(env, code) { return env.ROOMS.get(env.ROOMS.idFromName(code)) }

// Anfrage an das Raum-Objekt: eigene, geprüfte Parameter statt der Rohanfrage (Upgrade-Kopf bleibt erhalten).
function forward(req, origin, params) {
	const u = new URL(origin + '/room')
	for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v))
	return new Request(u.toString(), { method: 'GET', headers: req.headers })
}

export default {
	async fetch(req, env, ctx) {
		const url = new URL(req.url)
		const origin = url.origin
		if (url.pathname === '/c' || url.pathname.startsWith('/c/')) {
			return serveClient(req, env, {
				fetch: (u, init) => fetch(u, init), cache: defaultCache(),
				waitUntil: ctx && ctx.waitUntil ? (p) => ctx.waitUntil(p) : null,
			})
		}
		if (url.pathname === '/info') {
			const out = { game: 'mau-mau-flip', relay: RELAY_VERSION, proto: PROTO, source: source(env) }
			if (url.searchParams.has('room')) {
				const code = normalizeCode(url.searchParams.get('room') || '')
				if (!code) out.room = { open: false }
				else {
					const r = await roomStub(env, code).fetch(new Request(origin + '/info'))
					out.room = r.ok ? await r.json() : { open: false }
					out.room.code = code
				}
			}
			return json(out)
		}
		if (url.pathname === '/ws') {
			if ((req.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return text('websocket expected', 426)
			const q = url.searchParams
			const role = q.get('role')
			const agent = (req.headers.get('User-Agent') || '').slice(0, 120)
			if (role === 'host' && !q.get('room')) {
				const v = q.get('v') || ''
				if (!validVersion(v)) return text('version', 400)
				if (Number(q.get('proto') || 1) !== PROTO) return text('proto', 400)
				for (let i = 0; i < CREATE_TRIES; i++) {
					const code = newCode(cryptoRandom)
					const r = await roomStub(env, code).fetch(forward(req, origin, { role, create: 1, room: code, v, proto: PROTO, origin }))
					if (r.status !== 409) return r
				}
				return text('no free room code', 503)
			}
			if (role !== 'host' && role !== 'guest') return text('role', 400)
			const code = normalizeCode(q.get('room') || '')
			if (!code) return text('room', 400)
			const token = q.get('token') || ''
			if (role === 'host' && !validToken(token)) return text('token', 400)
			return roomStub(env, code).fetch(forward(req, origin, { role, room: code, token: role === 'host' ? token : '', agent, origin }))
		}
		return env.ASSETS.fetch(req)
	},
}

export class Room extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env)
		// Herzschlag ohne Wecken: Text "ping" → "pong" beantwortet Cloudflare selbst.
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
		const storage = ctx.storage
		this.core = new RelayRoom({
			now: () => Date.now(),
			accept: (ws, tags) => ctx.acceptWebSocket(ws, tags),
			sockets: (tag) => tag ? ctx.getWebSockets(tag) : ctx.getWebSockets(),
			send: (ws, t) => { try { ws.send(t) } catch (e) { } },
			close: (ws, code, reason) => { try { ws.close(code, reason) } catch (e) { } },
			attach: (ws, obj) => ws.serializeAttachment(obj),
			getAttach: (ws) => { try { return ws.deserializeAttachment() } catch (e) { return null } },
			storage: { get: (k) => storage.get(k), put: (k, v) => storage.put(k, v), deleteAll: () => storage.deleteAll() },
			setAlarm: (t) => storage.setAlarm(t),
			deleteAlarm: () => storage.deleteAlarm(),
		})
	}

	async fetch(req) {
		const url = new URL(req.url)
		if (url.pathname === '/info') return json(await this.core.info())
		if ((req.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return text('websocket expected', 426)
		const q = url.searchParams
		let client = null
		const res = await this.core.open({
			role: q.get('role'), room: q.get('room'), create: q.get('create') === '1', token: q.get('token') || '',
			v: q.get('v') || '', proto: q.get('proto') || '1', agent: q.get('agent') || '', origin: q.get('origin') || url.origin,
		}, () => { const pair = new WebSocketPair(); client = pair[0]; return pair[1] })
		if (res.status !== 101 || !client) return text(res.body || 'error', res.status === 101 ? 500 : res.status)
		return new Response(null, { status: 101, webSocket: client })
	}

	async webSocketMessage(ws, message) { await this.core.message(ws, message) }

	async webSocketClose(ws, code, reason) {
		await this.core.closed(ws, code)
		// Ältere Kompatibilitätsdaten antworten nicht selbst auf das Schließen; doppelt schadet nicht.
		try { ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, 'bye') } catch (e) { }
	}

	async webSocketError(ws) { await this.core.closed(ws, 1006) }

	async alarm() { await this.core.alarm() }
}
