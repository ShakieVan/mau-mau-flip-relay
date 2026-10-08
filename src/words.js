// Mau-Mau Flip – Vermittler: Wortliste für Raumcodes (Form WORT-ZZ, z. B. KATZE-42).
// Eigene Liste: kurze deutsche Wörter (3–6 Buchstaben, nur A–Z, ohne Umlaute), gut sprechbar und eindeutig im Diktat –
// Tiere, Natur, Tag/Nacht, Essen, Dinge. Keine Begriffe des Vorbilds, keine Farben- oder Kartennamen, nichts Anstößiges;
// relay/test/core.test.js prüft das gegen FORBIDDEN (Teilwörter). Neue Wörter nur anhängen, nie umsortieren nötig.

export const WORDS = Object.freeze([
	// Tiere
	'KATZE', 'HUND', 'MAUS', 'HASE', 'IGEL', 'FUCHS', 'DACHS', 'BIBER', 'OTTER', 'ELCH', 'REH', 'HIRSCH', 'WOLF', 'BAER',
	'ADLER', 'EULE', 'RABE', 'MEISE', 'SPATZ', 'AMSEL', 'TAUBE', 'ENTE', 'GANS', 'HUHN', 'HAHN', 'ZIEGE', 'SCHAF', 'PFERD',
	'ESEL', 'KUH', 'STIER', 'LAMM', 'FOHLEN', 'KALB', 'ZEBRA', 'LOEWE', 'TIGER', 'PANDA', 'KOALA', 'LEMUR', 'AFFE', 'KAMEL',
	'LAMA', 'ALPAKA', 'ROBBE', 'HAI', 'DELFIN', 'KRAKE', 'QUALLE', 'KREBS', 'HUMMER', 'FISCH', 'LACHS', 'HECHT', 'BIENE',
	'HUMMEL', 'AMEISE', 'KAEFER', 'FALTER', 'RAUPE', 'FROSCH', 'MOLCH', 'ECHSE', 'GECKO', 'PUMA', 'JAGUAR', 'LUCHS', 'MARDER',
	'WIESEL', 'MOEWE', 'STORCH', 'SCHWAN', 'FALKE', 'KIWI', 'PFOTE', 'KAUZ', 'FINK', 'STAR', 'GIMPEL', 'MURMEL',
	// Natur
	'MOND', 'SONNE', 'STERN', 'WOLKE', 'REGEN', 'SCHNEE', 'WIND', 'STURM', 'BLITZ', 'NEBEL', 'TAU', 'FROST', 'EIS', 'BERG',
	'TAL', 'FLUSS', 'BACH', 'SEE', 'MEER', 'WELLE', 'STRAND', 'INSEL', 'DUENE', 'WALD', 'BAUM', 'EICHE', 'BUCHE', 'BIRKE',
	'LINDE', 'TANNE', 'FICHTE', 'AHORN', 'MOOS', 'FARN', 'BLUME', 'ROSE', 'TULPE', 'LILIE', 'NELKE', 'MOHN', 'KLEE', 'GRAS',
	'HALM', 'BLATT', 'WURZEL', 'KNOSPE', 'STEIN', 'FELS', 'SAND', 'KIESEL', 'QUELLE', 'TEICH', 'HUEGEL', 'WIESE', 'FELD',
	'GARTEN', 'KOMET', 'PLANET', 'ORBIT', 'HIMMEL', 'KRATER', 'WIPFEL',
	// Tag und Nacht
	'MORGEN', 'MITTAG', 'ABEND', 'NACHT', 'LICHT', 'KERZE', 'LAMPE', 'FUNKE', 'GLANZ', 'TRAUM', 'SCHLAF', 'KISSEN', 'DECKE',
	'FEUER', 'ASCHE', 'GLUT',
	// Essen
	'BIRNE', 'APFEL', 'BEERE', 'MANGO', 'MELONE', 'FEIGE', 'DATTEL', 'KOKOS', 'NUSS', 'MANDEL', 'KUCHEN', 'KEKS', 'TORTE',
	'PLATTE', 'BREZEL', 'SEMMEL', 'BUTTER', 'HONIG', 'KAESE', 'MILCH', 'SAHNE', 'QUARK', 'MUESLI', 'NUDEL', 'REIS', 'BOHNE',
	'ERBSE', 'LINSE', 'MAIS', 'MOEHRE', 'GURKE', 'TOMATE', 'LAUCH', 'SALAT', 'SUPPE', 'PIZZA', 'KAKAO', 'TEE', 'KAFFEE',
	'SAFT', 'LIMO', 'ZIMT', 'SALBEI', 'MINZE', 'BONBON', 'BREI',
	// Dinge
	'BOOT', 'ANKER', 'SEGEL', 'BALL', 'DRACHE', 'GLOCKE', 'FLOETE', 'HARFE', 'GEIGE', 'PINSEL', 'TURM', 'BURG', 'HUETTE',
	'ZELT', 'KOFFER', 'SCHAL', 'MUETZE', 'SCHUH', 'KNOPF', 'FADEN', 'NADEL', 'KAMM', 'ROLLER', 'RAKETE', 'WAGEN', 'KARREN',
	'SCHIFF', 'HANDY', 'RADIO', 'TELLER', 'GABEL', 'SCHALE', 'KORB', 'BESEN', 'EIMER', 'LEITER', 'WIEGE',
])

// Teilwörter, die in keinem Raumcode-Wort vorkommen dürfen: Farben, Karten und Spielaktionen,
// Zahlwörter (Diktat), Anstößiges. Nur für die Prüfung in den Tests.
export const FORBIDDEN = Object.freeze([
	'ROT', 'GELB', 'GRUEN', 'BLAU', 'PINK', 'LILA', 'TUERKIS', 'ORANGE', 'SCHWARZ', 'WEISS', 'JOKER', 'KARTE',
	'ZIEH', 'AUSSETZ', 'WUNSCH', 'TAUSCH', 'FLIP', 'MAUMAU', 'ASS', 'DAME', 'KOENIG', 'BUBE', 'HERZ', 'PIK', 'KREUZ', 'KARO',
	'NULL', 'EINS', 'ZWEI', 'DREI', 'VIER', 'FUENF', 'SECHS', 'SIEBEN', 'NEUN', 'ZEHN', 'PLUS',
	'SEX', 'NAZI', 'HITLER', 'ARSCH', 'KACK', 'PISS', 'FICK', 'TOD', 'MORD', 'HASS', 'KILL', 'DOOF', 'BLOED', 'DUMM', 'SAU',
	'NEGER', 'HURE', 'GIFT', 'WAFFE', 'BOMBE', 'BLUT',
])
