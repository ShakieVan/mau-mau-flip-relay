// Mau-Mau Flip – Lader des Vermittlers (Startseite /): liest ?r=CODE, fragt /info?room=CODE und leitet auf den
// Browser-Client in der Version des Gastgebers um (/c/<version>/?r=CODE). Den Client dieser Version holt der Vermittler selbst
// aus dem Quell-Repo (Tag v<version>, relay/src/client.js); eine Versionsliste gibt es nicht mehr. Reines ES-Modul; decide() und
// looseCode() prüft relay/test/core.test.js. Die genaue Prüfung des Codes (Wortliste) macht der Vermittler.

export const TEXTS = {
	de: {
		title: 'Mau-Mau Flip – online mitspielen',
		lead: 'Gib den Raumcode ein, den dir der Gastgeber zeigt (z. B. KATZE-42).',
		code: 'Raumcode', join: 'Beitreten', wait: 'Raum wird gesucht …',
		no_room: 'Diesen Raum gibt es nicht (mehr). Bitte den Code prüfen.',
		host_away: 'Der Gastgeber ist gerade nicht verbunden. Gleich noch einmal versuchen.',
		bad_code: 'Das ist kein gültiger Raumcode (Form WORT-ZAHL, z. B. KATZE-42).',
		net: 'Der Vermittler antwortet nicht. Internetverbindung prüfen.',
		version: 'Der Gastgeber nutzt eine Spielversion ({v}), für die es keinen Browser-Client gibt. Mit der App beitreten oder den Gastgeber bitten, die App zu aktualisieren.',
		address: 'Vermittler-Adresse für die App (Einstellungen → Online):',
		about: 'Dieser Vermittler reicht nur Nachrichten zwischen den Mitspielern durch; das Spiel läuft auf dem Handy des Gastgebers.',
	},
	en: {
		title: 'Mau-Mau Flip – play online',
		lead: 'Enter the room code shown by the host (e.g. KATZE-42).',
		code: 'Room code', join: 'Join', wait: 'Looking for the room …',
		no_room: 'This room does not exist (any more). Please check the code.',
		host_away: 'The host is not connected right now. Try again in a moment.',
		bad_code: 'This is not a valid room code (WORD-NUMBER, e.g. KATZE-42).',
		net: 'The relay does not answer. Check your internet connection.',
		version: 'The host uses a game version ({v}) without a browser client. Join with the app or ask the host to update the app.',
		address: 'Relay address for the app (Settings → Online):',
		about: 'This relay only passes messages between the players; the game runs on the host’s phone.',
	},
}

export function lang(navLang) { return /^de\b/i.test(navLang || '') ? 'de' : 'en' }

// Grobe Form wie normalizeCode im Vermittler, aber ohne Wortliste: "WORT-ZZ" oder "".
export function looseCode(input) {
	if (typeof input !== 'string' || input.length > 40) return ''
	const s = input.trim().toUpperCase()
		.replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ẞ/g, 'SS').replace(/ß/g, 'SS')
		.replace(/[\s_\-–.]+/g, '')
	const m = /^([A-Z]{3,6})([1-9]\d)$/.exec(s)
	return m ? m[1] + '-' + m[2] : ''
}

// info: Antwort von /info?room=CODE. Ergebnis {action: 'ask'|'error'|'go', why?, url?, version?, host?}
// Ob es den Client der Version wirklich gibt, zeigt erst /c/<version>/ (sonst zweisprachige 404-Seite des Vermittlers).
export function decide(info, code) {
	if (!code) return { action: 'ask' }
	if (!info || !info.room || !info.room.open) return { action: 'error', why: 'no_room' }
	const v = String(info.room.version || '')
	if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v)) return { action: 'error', why: 'version', version: v }
	return { action: 'go', url: '/c/' + v + '/?r=' + encodeURIComponent(code), version: v, host: !!info.room.host }
}
