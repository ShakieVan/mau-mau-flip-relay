// Mau-Mau Flip – Vermittler-Kern (docs/online/ENTWURF.md, Abschnitte 1 und 2).
// Reines ES-Modul ohne Cloudflare-Abhängigkeiten: Die Umgebung (Sockets, Speicher, Alarm, Zeit, Zufall) wird eingespritzt.
// worker.js verbindet das mit der Durable-Object-API (Hibernation); relay/test/core.test.js prüft es in Chrome headless gegen
// relay/test/vectors.json, dieselben Vektoren laufen gegen den GDScript-Nachbau (game/scripts/net/net_relay_double.gd).
//
// Der Vermittler parst den Spieltext d nie: Gast → Gastgeber wird er nur als JSON-String eingepackt, Gastgeber → Gast unverändert
// weitergereicht. Inhalte, Raumcodes und Tokens werden nie geloggt; gespeichert wird nur die Zeile meta je Raum.

import { WORDS } from './words.js'

export const RELAY_VERSION = 2   // Fassung dieses Vermittlers (/info relay); 2 = holt den Browser-Client selbst von GitHub (/c/*)
export const PROTO = 1           // Umschlag-Protokoll Gastgeber ↔ Vermittler (/info proto, ?proto= beim Anlegen)

export const LIMITS = Object.freeze({
	guests: 16,               // Gast-Verbindungen je Raum (10 Spieler + Überlappung beim Wiederverbinden)
	msg: 8192,                // Byte je Nachricht Gast → Gastgeber (sonst drop size)
	host_msg: 262144,         // Byte je Rahmen Gastgeber → Vermittler (sonst Gastgeber-Socket 1009)
	rate: 20,                 // Nachrichten/s je Gast (Token-Eimer) …
	burst: 40,                // … mit dieser Spitze; sonst drop rate
	rate_kick_s: 10,          // Dauerverstoß so lange → 4429
	host_rate: 200,           // Rahmen/s des Gastgebers (Spitze 400), sonst err rate
	host_burst: 400,
	grace_s: 600,             // Abwesenheit des Gastgebers, danach wird der Raum gelöscht
	life_s: 86400,            // Lebensdauer eines Raums ab Anlegen
	ping_s: 25,               // Herzschlag der Gegenstellen: Text "ping" (Antwort "pong" ohne Wecken)
	idle_s: 70,               // so lange Stille → Gegenstelle gilt als getrennt (prüfen die Clients)
	retry_s: 10,              // nach 4503 so lange warten
	agent: 120,               // Zeichen des User-Agent im open-Rahmen
	send_many: 64,            // höchstens so viele Ziele je send-Rahmen
	reason: 100,              // Zeichen des Grundes bei kick
})

export const CLOSE = Object.freeze({
	NORMAL: 1000, ENDED: 1001, UNSUPPORTED: 1003, TOO_BIG: 1009,
	REPLACED: 4000, TOKEN: 4403, NO_ROOM: 4404, FULL: 4409, RATE: 4429, HOST_AWAY: 4503,
})

// ---------- Raumcodes ----------

const WORD_SET = new Set(WORDS)

// Eingabe → "WORT-ZZ" oder "" (ungültig). Großbuchstaben, Umlaute → AE/OE/UE/SS, Leer-/Unterstrich/fehlender Strich erlaubt.
export function normalizeCode(input) {
	if (typeof input !== 'string' || input.length > 40) return ''
	let s = input.trim().toUpperCase()
		.replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ẞ/g, 'SS').replace(/ß/g, 'SS')
	s = s.replace(/[\s_\-–.]+/g, '')
	const m = /^([A-Z]{3,6})(\d{2})$/.exec(s)
	if (!m || !WORD_SET.has(m[1])) return ''
	const n = Number(m[2])
	if (n < 10 || n > 99) return ''
	return m[1] + '-' + m[2]
}

// Zufälliger Code; random() liefert [0, 1).
export function newCode(random = Math.random) {
	const w = WORDS[Math.min(WORDS.length - 1, Math.floor(random() * WORDS.length))]
	const n = 10 + Math.min(89, Math.floor(random() * 90))
	return w + '-' + n
}

export function codeCount() { return WORDS.length * 90 }

// ---------- Hilfen ----------

export function utf8Length(s) {
	if (s.length * 3 <= 8192) {
		let ascii = true
		for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) { ascii = false; break }
		if (ascii) return s.length
	}
	let n = 0
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i)
		if (c < 0x80) n += 1
		else if (c < 0x800) n += 2
		else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++ }
		else n += 3
	}
	return n
}

export async function sha256Hex(text) {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
	return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}

export function randomToken() {
	const b = new Uint8Array(16)
	crypto.getRandomValues(b)
	return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
}

export function validVersion(v) { return typeof v === 'string' && /^[0-9A-Za-z.+-]{1,32}$/.test(v) }
export function validToken(t) { return typeof t === 'string' && /^[0-9a-f]{32,64}$/.test(t) }

function kickCode(code) {
	const c = Number(code)
	if (!Number.isInteger(c)) return CLOSE.NORMAL
	if (c === 1000 || c === 1001 || c === 1008 || (c >= 3000 && c <= 4999)) return c
	return CLOSE.NORMAL
}

// Token-Eimer: rate je Sekunde, Spitze burst. Verstoß-Serie: beginnt mit dem ersten Verwerfen und reißt ab, wenn länger als 1 s
// nichts verworfen wurde; badSince = Beginn der laufenden Serie (Dauerverstoß → 4429).
class Bucket {
	constructor(rate, burst, now) { this.rate = rate; this.burst = burst; this.tokens = burst; this.at = now; this.badSince = 0; this.lastBad = 0 }
	take(now) {
		this.tokens = Math.min(this.burst, this.tokens + (now - this.at) * this.rate / 1000)
		this.at = now
		if (this.tokens >= 1) { this.tokens -= 1; return true }
		if (!this.badSince || now - this.lastBad > 1000) this.badSince = now
		this.lastBad = now
		return false
	}
}

// ---------- Raum ----------

// env: {
//   now() → ms; accept(ws, tags); sockets(tag?) → Array; send(ws, text); close(ws, code, reason);
//   attach(ws, obj); getAttach(ws) → obj|null;
//   storage: { get(key) → Promise, put(key, val) → Promise, deleteAll() → Promise };
//   setAlarm(ms) → Promise; deleteAlarm() → Promise;
//   hash(text) → Promise<hex> (Standard sha256Hex); token() → hex (Standard randomToken)
// }
export class RelayRoom {
	constructor(env) {
		this.env = env
		this.hash = env.hash || sha256Hex
		this.token = env.token || randomToken
		this._meta = undefined       // undefined = noch nicht geladen, null = kein Raum
		this.gone = new WeakSet()    // Sockets, die der Vermittler selbst geschlossen hat (deren Schließen nicht noch einmal melden)
		this.buckets = new Map()     // Ratenzähler (nur im Speicher; gehen beim Schlafen verloren – unkritisch)
		this.ended = false
	}

	async meta() {
		if (this._meta === undefined) this._meta = (await this.env.storage.get('meta')) || null
		return this._meta
	}

	async saveMeta(m) { this._meta = m; await this.env.storage.put('meta', m) }

	hosts(except = null) { return this.env.sockets('host').filter(w => w !== except && !this.gone.has(w)) }
	guests() { return this.env.sockets('guest').filter(w => !this.gone.has(w)) }
	guestByC(c) { return this.env.sockets('c:' + c).find(w => !this.gone.has(w)) || null }

	toHost(obj, host = null) {
		const t = JSON.stringify(obj)
		for (const h of (host ? [host] : this.hosts())) this.env.send(h, t)
	}

	shut(ws, code, reason = '') {
		if (this.gone.has(ws)) return
		this.gone.add(ws)
		this.env.close(ws, code, reason)
	}

	// Nächste Verbindungsnummer: über alle Attachments (Gäste und next des Gastgebers), überlebt so die Hibernation.
	nextC() {
		let max = this._meta && this._meta.next ? this._meta.next - 1 : 0
		for (const w of this.env.sockets()) {
			const a = this.env.getAttach(w)
			if (!a) continue
			if (a.c > max) max = a.c
			if (a.next && a.next - 1 > max) max = a.next - 1
		}
		return max + 1
	}

	link(origin, code) { return (origin || '') + '/?r=' + code }

	roomFrame(m, origin, token) {
		const f = { k: 'room', room: m.code, link: this.link(origin, m.code), limits: {
			guests: LIMITS.guests, msg: LIMITS.msg, host_msg: LIMITS.host_msg, rate: LIMITS.rate, grace_s: LIMITS.grace_s,
			life_s: LIMITS.life_s, ping_s: LIMITS.ping_s, idle_s: LIMITS.idle_s } }
		if (token) f.token = token
		return f
	}

	// Neue Verbindung. q: {role, room, create, token, v, proto, agent, origin}; makeSocket() legt den Socket erst an, wenn die
	// Anfrage nicht schon per HTTP abgelehnt wird. Ergebnis {status, body} – 101 = angenommen (auch wenn gleich wieder geschlossen).
	async open(q, makeSocket) {
		const m = await this.meta()
		const now = this.env.now()
		if (q.role === 'host' && q.create) {
			if (m) return { status: 409, body: 'busy' }
			if (!validVersion(q.v)) return { status: 400, body: 'version' }
			if (Number(q.proto || 1) !== PROTO) return { status: 400, body: 'proto' }
			const token = this.token()
			const meta = { code: q.room, tokenHash: await this.hash(token), proto: PROTO, version: q.v, created: now, hostGoneAt: 0 }
			await this.saveMeta(meta)
			await this.env.setAlarm(now + LIMITS.life_s * 1000)
			this.ended = false
			const ws = makeSocket()
			this.env.accept(ws, ['host'])
			this.env.attach(ws, { role: 'host', c: 0, since: now, next: 1 })
			this.toHost(this.roomFrame(meta, q.origin, token), ws)
			return { status: 101 }
		}
		const ws = makeSocket()
		if (q.role === 'host') {
			this.env.accept(ws, ['host'])
			if (!m) { this.shut(ws, CLOSE.NO_ROOM, 'no room'); return { status: 101 } }
			if (!q.token || (await this.hash(q.token)) !== m.tokenHash) { this.shut(ws, CLOSE.TOKEN, 'token'); return { status: 101 } }
			let next = this.nextC()
			for (const old of this.hosts(ws)) this.shut(old, CLOSE.REPLACED, 'replaced')
			this.env.attach(ws, { role: 'host', c: 0, since: now, next })
			if (m.hostGoneAt) {
				await this.saveMeta({ ...m, hostGoneAt: 0 })
				await this.env.setAlarm(m.created + LIMITS.life_s * 1000)
			}
			this.toHost(this.roomFrame(m, q.origin, ''), ws)
			return { status: 101 }
		}
		// Gast. Abgelehnte Gäste bekommen c = 0 (erreichen den Gastgeber nie, verbrauchen keine Nummer).
		const hosts = this.hosts()
		const reject = !m ? CLOSE.NO_ROOM : (m.hostGoneAt || hosts.length === 0) ? CLOSE.HOST_AWAY
			: this.guests().length >= LIMITS.guests ? CLOSE.FULL : 0
		const c = reject ? 0 : this.nextC()
		this.env.accept(ws, ['guest', 'c:' + c])
		this.env.attach(ws, { role: 'guest', c, since: now })
		if (reject) { this.shut(ws, reject, reject === CLOSE.NO_ROOM ? 'no room' : reject === CLOSE.FULL ? 'full' : 'host away'); return { status: 101 } }
		for (const h of hosts) { const a = this.env.getAttach(h) || {}; this.env.attach(h, { ...a, next: c + 1 }) }
		this.toHost({ k: 'open', c, info: { agent: String(q.agent || '').slice(0, LIMITS.agent) } })
		return { status: 101 }
	}

	async info() {
		const m = await this.meta()
		if (!m) return { open: false }
		return { open: true, host: !m.hostGoneAt && this.hosts().length > 0, version: m.version }
	}

	async message(ws, data) {
		if (this.gone.has(ws)) return
		const a = this.env.getAttach(ws)
		if (!a) return
		const now = this.env.now()
		if (data === 'ping') { this.env.send(ws, 'pong'); return }   // nur ohne Auto-Antwort (Nachbau); Cloudflare antwortet selbst
		if (a.role === 'guest') {
			if (typeof data !== 'string') { this.dropGuest(ws, a.c, CLOSE.UNSUPPORTED, 'binary'); return }
			const size = utf8Length(data)
			if (size > LIMITS.msg) { this.toHost({ k: 'drop', c: a.c, why: 'size', size }); return }
			let b = this.buckets.get(ws)
			if (!b) { b = new Bucket(LIMITS.rate, LIMITS.burst, now); this.buckets.set(ws, b) }
			if (!b.take(now)) {
				if (now - b.badSince >= LIMITS.rate_kick_s * 1000) { this.dropGuest(ws, a.c, CLOSE.RATE, 'rate'); return }
				this.toHost({ k: 'drop', c: a.c, why: 'rate', size })
				return
			}
			this.toHost({ k: 'msg', c: a.c, d: data })
			return
		}
		// Gastgeber
		if (typeof data !== 'string') { this.toHost({ k: 'err', code: 'bad' }, ws); return }
		if (utf8Length(data) > LIMITS.host_msg) { this.shut(ws, CLOSE.TOO_BIG, 'too big'); await this.hostLeft(); return }
		let b = this.buckets.get(ws)
		if (!b) { b = new Bucket(LIMITS.host_rate, LIMITS.host_burst, now); this.buckets.set(ws, b) }
		if (!b.take(now)) { this.toHost({ k: 'err', code: 'rate' }, ws); return }
		let f
		try { f = JSON.parse(data) } catch (e) { f = null }
		if (!f || typeof f !== 'object' || Array.isArray(f)) { this.toHost({ k: 'err', code: 'bad' }, ws); return }
		if (f.k === 'send') {
			const list = Array.isArray(f.c) ? f.c : [f.c]
			if (typeof f.d !== 'string' || list.length === 0 || list.length > LIMITS.send_many || !list.every(Number.isInteger)) {
				this.toHost({ k: 'err', code: 'bad' }, ws); return
			}
			for (const c of list) {
				const g = this.guestByC(c)
				if (g) this.env.send(g, f.d)
				else this.toHost({ k: 'err', code: 'unknown_c', c }, ws)
			}
		} else if (f.k === 'kick') {
			if (!Number.isInteger(f.c)) { this.toHost({ k: 'err', code: 'bad' }, ws); return }
			const g = this.guestByC(f.c)
			if (!g) { this.toHost({ k: 'err', code: 'unknown_c', c: f.c }, ws); return }
			const code = kickCode(f.code)
			this.shut(g, code, String(f.reason || '').slice(0, LIMITS.reason))
			this.buckets.delete(g)
			this.toHost({ k: 'close', c: f.c, code }, ws)
		} else if (f.k === 'end') {
			await this.end()
		} else {
			this.toHost({ k: 'err', code: 'bad' }, ws)
		}
	}

	dropGuest(ws, c, code, reason) {
		this.shut(ws, code, reason)
		this.buckets.delete(ws)
		this.toHost({ k: 'close', c, code })
	}

	// Socket geschlossen (von der Gegenstelle) oder Fehler.
	async closed(ws, code) {
		if (this.gone.has(ws)) return
		this.gone.add(ws)
		this.buckets.delete(ws)
		const a = this.env.getAttach(ws)
		if (!a) return
		if (a.role === 'guest') {
			if (a.c) this.toHost({ k: 'close', c: a.c, code: Number(code) || 1005 })
			return
		}
		await this.hostLeft()
	}

	// Kein Gastgeber mehr da: Gäste mit 4503 schließen, Abwesenheit merken, Alarm auf +grace.
	async hostLeft() {
		if (this.hosts().length > 0) return
		const m = await this.meta()
		if (!m || this.ended) return
		const next = this.nextC()   // vor dem Schließen: Nummern werden nach der Rückkehr nicht wiederverwendet
		for (const g of this.guests()) { this.shut(g, CLOSE.HOST_AWAY, 'host away'); this.buckets.delete(g) }
		if (m.hostGoneAt) return
		const now = this.env.now()
		await this.saveMeta({ ...m, hostGoneAt: now, next })
		await this.env.setAlarm(Math.min(now + LIMITS.grace_s * 1000, m.created + LIMITS.life_s * 1000))
	}

	async alarm() {
		const m = await this.meta()
		const now = this.env.now()
		if (!m) { await this.env.storage.deleteAll(); return }
		const lifeEnd = m.created + LIMITS.life_s * 1000
		const graceEnd = m.hostGoneAt ? m.hostGoneAt + LIMITS.grace_s * 1000 : Infinity
		if (now >= lifeEnd || now >= graceEnd) { await this.end(); return }
		await this.env.setAlarm(Math.min(lifeEnd, graceEnd))
	}

	// Raum schließen: alle bekommen 1001, Speicher und Alarm weg, Code wieder frei.
	async end() {
		this.ended = true
		for (const w of this.env.sockets()) { this.shut(w, CLOSE.ENDED, 'ended'); this.buckets.delete(w) }
		this._meta = null
		await this.env.storage.deleteAll()
		if (this.env.deleteAlarm) await this.env.deleteAlarm()
	}
}
