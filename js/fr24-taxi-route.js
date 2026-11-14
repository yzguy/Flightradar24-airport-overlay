(function (root) {
	var PHONETIC = {
		alpha: "A", alfa: "A", bravo: "B", charlie: "C", delta: "D", echo: "E", foxtrot: "F", fox: "F",
		golf: "G", hotel: "H", india: "I", juliet: "J", juliett: "J", kilo: "K", lima: "L", mike: "M",
		november: "N", oscar: "O", papa: "P", quebec: "Q", romeo: "R", sierra: "S", tango: "T",
		uniform: "U", victor: "V", whiskey: "W", whisky: "W", xray: "X", yankee: "Y", zulu: "Z"
	};
	var DIGITS = {
		zero: "0", one: "1", two: "2", three: "3", tree: "3", four: "4", fower: "4", five: "5", fife: "5",
		six: "6", seven: "7", eight: "8", nine: "9", niner: "9"
	};
	var TEENS = {
		ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15",
		sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19"
	};
	var TENS = { twenty: "2", thirty: "3", forty: "4", fifty: "5", sixty: "6", seventy: "7", eighty: "8", ninety: "9" };
	var SIDES = { l: "L", left: "L", r: "R", right: "R", c: "C", center: "C", centre: "C" };

	// Spoken airline callsign (telephony) -> ICAO code.
	var AIRLINES = {
		// US mainline, low-cost and regional
		"american": "AAL", "delta": "DAL", "united": "UAL", "southwest": "SWA", "spirit wings": "NKS",
		"spirit": "NKS", "frontier flight": "FFT", "frontier": "FFT", "alaska": "ASA", "jetblue": "JBU",
		"jet blue": "JBU", "hawaiian": "HAL", "sun country": "SCX", "allegiant": "AAY", "moxy": "MXY",
		"breeze": "MXY", "avelo": "VXP", "envoy": "ENY", "skywest": "SKW", "sky west": "SKW",
		"air shuttle": "ASH", "brickyard": "RPA", "blue streak": "JIA", "piedmont": "PDT",
		"endeavor": "EDV", "flagship": "EDV", "lindbergh": "GJS", "horizon": "QXE", "commutair": "UCA",
		"commuter": "UCA", "wisconsin": "AWI", "silver wings": "SIL", "cair": "KAP", "southern express": "SOO",
		"contour": "VTE",
		// Cargo, charter and business
		"fedex": "FDX", "fed ex": "FDX", "ups": "UPS", "giant": "GTI", "polar": "PAC", "connie": "CKS",
		"abex": "ABX", "air transport": "ATN", "western global": "WGN", "ameriflight": "AMF",
		"amflight": "AMF", "execjet": "EJA", "flexjet": "LXJ", "reach": "RCH", "omni express": "OAE",
		"cactus": "AWE",
		// Canada and Latin America
		"air canada": "ACA", "jazz": "JZA", "westjet": "WJA", "porter": "POE", "flair": "FLE",
		"transat": "TSC", "volaris": "VOI", "aeromexico": "AMX", "aerobus": "VIV", "copa": "CMP",
		"avianca": "AVA", "lan": "LAN", "lan chile": "LAN", "tam": "TAM", "caribbean airlines": "BWA",
		"bahamas": "BHS",
		// Europe, Middle East, Africa
		"speedbird": "BAW", "virgin": "VIR", "shamrock": "EIN", "lufthansa": "DLH", "air france": "AFR",
		"airfrans": "AFR", "klm": "KLM", "iberia": "IBE", "swiss": "SWR", "austrian": "AUA",
		"scandinavian": "SAS", "finnair": "FIN", "iceair": "ICE", "air portugal": "TAP", "turkish": "THY",
		"itarrow": "ITY", "lot": "LOT", "edelweiss": "EDW", "condor": "CFG", "el al": "ELY",
		"emirates": "UAE", "etihad": "ETD", "qatari": "QTR", "saudia": "SVA", "jordanian": "RJA",
		"ethiopian": "ETH", "royalair maroc": "RAM", "egyptair": "MSR",
		// Asia-Pacific
		"qantas": "QFA", "new zealand": "ANZ", "korean air": "KAL", "asiana": "AAR", "japan air": "JAL",
		"all nippon": "ANA", "cathay": "CPA", "singapore": "SIA", "eva": "EVA", "dynasty": "CAL",
		"air china": "CCA", "china eastern": "CES", "china southern": "CSN", "philippine": "PAL",
		"air india": "AIC", "starwalker": "SJX"
	};
	var AIRLINE_CODES = {};
	for (var name in AIRLINES) AIRLINE_CODES[AIRLINES[name]] = true;

	var LIST_STOP = {
		hold: 1, cross: 1, runway: 1, contact: 1, monitor: 1, expect: 1, give: 1, follow: 1, to: 1,
		via: 1, turn: 1, taxi: 1, continue: 1, ground: 1, tower: 1
	};
	var LIST_SKIP = { ",": 1, and: 1, then: 1, taxiway: 1, left: 1, right: 1, on: 1, onto: 1 };

	function tokenize(text) {
		return text.toLowerCase().replace(/x-ray/g, "xray").replace(/,/g, " , ")
			.replace(/[^a-z0-9, ]+/g, " ").split(/\s+/).filter(Boolean);
	}

	function isNumberWord(w) {
		return /^\d+$/.test(w) || DIGITS[w] || TEENS[w] || TENS[w] || w === "hundred" || w === "thousand";
	}

	// Handles digit-by-digit ("two three four five"), paired ("twenty three forty
	// five") and cardinal ("three thousand four hundred one") flight numbers.
	function readNumber(t, i) {
		var j = i;
		while (j < t.length && (isNumberWord(t[j]) ||
			// "five hundred and one"
			(t[j] === "and" && /^(hundred|thousand)$/.test(t[j - 1]) && j + 1 < t.length && isNumberWord(t[j + 1])))) j++;
		if (j === i || t[i] === "hundred" || t[i] === "thousand") return null;
		var words = t.slice(i, j).filter(function (w) { return w !== "and"; });
		if (words.indexOf("thousand") >= 0 || words.indexOf("hundred") >= 0) {
			var total = 0, cur = 0;
			words.forEach(function (w) {
				if (w === "thousand") { total += (cur || 1) * 1000; cur = 0; }
				else if (w === "hundred") cur = (cur || 1) * 100;
				else if (TENS[w]) cur += parseInt(TENS[w], 10) * 10;
				else cur += parseInt(DIGITS[w] || TEENS[w] || w, 10);
			});
			return { text: String(total + cur), next: j };
		}
		var s = "";
		for (var k = 0; k < words.length; k++) {
			var w = words[k];
			if (TENS[w]) {
				if (DIGITS[words[k + 1]] && DIGITS[words[k + 1]] !== "0") { s += TENS[w] + DIGITS[words[++k]]; }
				else s += TENS[w] + "0";
			} else s += DIGITS[w] || TEENS[w] || w;
		}
		return { text: s, next: j };
	}

	function readRunway(t, i, known) {
		var m = /^(\d{1,2})([lrc])$/.exec(t[i] || "");
		var num, next;
		if (m) { num = m[1]; next = i + 1; }
		else {
			var n = readNumber(t, i);
			if (!n || n.text.length > 2) return null;
			num = n.text; next = n.next;
		}
		var side = "";
		if (m) side = m[2].toUpperCase();
		else if (SIDES[t[next]]) side = SIDES[t[next++]];
		var ref = (num.length === 1 ? "0" + num : num) + side;
		if (known.runways[ref]) return { ref: ref, next: next };
		if (known.runways[num + side]) return { ref: num + side, next: next };
		return null;
	}

	function atomsFrom(t, i, known) {
		var atoms = [], j = i;
		while (j < t.length && atoms.length < 4) {
			var w = t[j];
			if (PHONETIC[w]) { atoms.push({ s: PHONETIC[w], next: j + 1 }); j++; continue; }
			var num = readNumber(t, j);
			if (num) { atoms.push({ s: num.text, next: num.next }); j = num.next; continue; }
			if (/^[a-z]{1,2}\d{0,2}$/.test(w) && known.taxiways[w.toUpperCase()]) {
				atoms.push({ s: w.toUpperCase(), next: j + 1 }); j++; continue;
			}
			break;
		}
		return atoms;
	}

	// Joins spoken letters/digits into the longest known taxiway name, e.g. "echo juliet" -> EJ.
	function readTaxiway(t, i, known) {
		var atoms = atomsFrom(t, i, known);
		if (!atoms.length || /^\d/.test(atoms[0].s)) return null;
		for (var n = Math.min(3, atoms.length); n >= 1; n--) {
			var ref = atoms.slice(0, n).map(function (a) { return a.s; }).join("");
			if (known.taxiways[ref]) return { ref: ref, next: atoms[n - 1].next, known: true };
		}
		return { ref: atoms[0].s, next: atoms[0].next, known: false };
	}

	function readTaxiwayList(t, i, known, out) {
		while (i < t.length) {
			if (LIST_SKIP[t[i]]) { i++; continue; }
			if (LIST_STOP[t[i]]) break;
			var tw = readTaxiway(t, i, known);
			if (!tw) break;
			if (!tw.known) out.warnings.push("Unknown taxiway " + tw.ref);
			if (out.taxiways[out.taxiways.length - 1] !== tw.ref) out.taxiways.push(tw.ref);
			i = tw.next;
		}
		return i;
	}

	// Aircraft types GA pilots and controllers say before an abbreviated tail ("Cessna three alpha bravo").
	var AIRCRAFT_TYPES = {
		"cessna": 1, "skyhawk": 1, "skylane": 1, "caravan": 1, "citation": 1, "piper": 1, "cherokee": 1,
		"archer": 1, "warrior": 1, "seminole": 1, "cirrus": 1, "beech": 1, "beechcraft": 1, "bonanza": 1,
		"baron": 1, "king air": 1, "mooney": 1, "diamond": 1, "pilatus": 1, "gulfstream": 1, "lear": 1,
		"learjet": 1, "challenger": 1, "falcon": 1, "hawker": 1, "phenom": 1, "embraer": 1, "global": 1,
		"helicopter": 1, "experimental": 1, "november": 1
	};
	var US_TAIL = /^[1-9]\d{0,4}[A-Z]{0,2}$/;

	// Reads spoken registration characters, keeping the longest prefix that is a valid US tail.
	function readTail(t, j, pattern) {
		var s = "", best = null;
		while (j < t.length && s.length < 6) {
			var num = PHONETIC[t[j]] ? null : readNumber(t, j);
			if (PHONETIC[t[j]]) { s += PHONETIC[t[j]]; j++; }
			else if (num) { s += num.text; j = num.next; }
			else break;
			if (s.length <= 5 && pattern.test(s)) best = { text: s, next: j };
		}
		return best;
	}

	// Letters after the flight number ("Etihad nine zero mike heavy" -> ETD90M) are
	// part of many international callsigns but can also be a taxiway, so offer both.
	function withSuffix(code, n, t) {
		var j = n.next, letters = "";
		while (letters.length < 2 && PHONETIC[t[j]] && t[j] !== "november") letters += PHONETIC[t[j++]];
		var heavy = /^(heavy|super)$/.test(t[j]);
		var base = code + n.text;
		var res = { callsign: base, end: n.next };
		if (letters) res.options = [base + letters].concat(letters.length > 1 ? [base + letters[0]] : [], [base]);
		if (heavy) res.end = j + 1;
		else if (/^(heavy|super)$/.test(t[n.next])) res.end = n.next + 1;
		return res;
	}

	function readCallsign(t, from, to) {
		for (var i = from; i < to; i++) {
			var w = t[i], res = null;
			var m = /^([a-z]{3})(\d{1,4}[a-z]{0,2})$/.exec(w);
			if (m) res = { callsign: w.toUpperCase(), end: i + 1 };
			else if (/^n\d{1,5}[a-z]{0,2}$/.test(w)) res = { callsign: w.toUpperCase(), end: i + 1 };
			else if (/^[a-z]{3}$/.test(w) && AIRLINE_CODES[w.toUpperCase()] && readNumber(t, i + 1)) {
				res = withSuffix(w.toUpperCase(), readNumber(t, i + 1), t);
			}
			for (var len = 2; !res && len >= 1; len--) {
				var name = t.slice(i, i + len).join(" "), n;
				if (AIRLINES[name] && (n = readNumber(t, i + len))) res = withSuffix(AIRLINES[name], n, t);
				else if (AIRCRAFT_TYPES[name]) {
					var full = name === "november" && readTail(t, i + 1, US_TAIL);
					var part = !full && readTail(t, i + len, /^\d{0,5}[A-Z]{0,2}$/);
					if (full) res = { callsign: "N" + full.text, end: full.next };
					else if (part && part.text.length >= 2) res = { tail: part.text, end: part.next };
				}
			}
			if (res) { res.start = i; return res; }
		}
		return null;
	}

	/**
	 * Parse a taxi instruction such as
	 *   "American 2345, runway 17R, taxi via Kilo, Echo Juliet, hold short of 17C"
	 *   "AAL2345 17R via K EJ hold short 17C"
	 * known: { taxiways: {REF: true}, runways: {"17R": true} }
	 */
	function parse(text, known) {
		var t = tokenize(text);
		var res = { callsign: null, runway: null, taxiways: [], holdShort: [], cross: [], warnings: [] };
		// Maintenance tows ("Delta Maintenance 9571") use the aircraft's fleet number, not a
		// flight number, so they must not be matched to flights.
		for (var x = 0; x < t.length; x++) {
			if (/^(maint\w*|main|maine|mainus|maina|mane|manus|minus|munich)$/.test(t[x]) &&
				(AIRLINES[t[x - 1]] || t[x - 1] === "for" || t[x] !== "main" && /^maint/.test(t[x]))) {
				var ship = readNumber(t, x + 1 + (t[x + 1] === "is" ? 1 : 0));
				res.tow = { airline: AIRLINES[t[x - 1]] || null, ship: ship ? ship.text : null };
				break;
			}
		}
		var firstKeyword = t.length;
		for (var k = 0; k < t.length; k++) if (LIST_STOP[t[k]]) { firstKeyword = k; break; }
		var cs = res.tow ? null : readCallsign(t, 0, firstKeyword);
		function useCallsign(c) {
			if (c.callsign) res.callsign = c.callsign;
			if (c.options) res.callsignOptions = c.options;
			if (c.tail) res.tail = c.tail;
		}
		if (cs) useCallsign(cs);

		var i = 0;
		while (i < t.length) {
			if (cs && i >= cs.start && i < cs.end) { i = cs.end; continue; }
			var w = t[i], j, r, tw;
			if (w === "via") { i = readTaxiwayList(t, i + 1, known, res); continue; }
			if (w === "turn" || w === "continue") {
				j = i + 1;
				while (LIST_SKIP[t[j]]) j++;
				tw = readTaxiway(t, j, known);
				if (tw && tw.known) { res.taxiways.push(tw.ref); i = readTaxiwayList(t, tw.next, known, res); continue; }
				i = j; continue;
			}
			if (w === "hold" && t[i + 1] === "short") {
				j = i + 2;
				if (t[j] === "of") j++;
				if (t[j] === "runway") j++;
				r = readRunway(t, j, known);
				if (r) { res.holdShort.push({ type: "runway", ref: r.ref }); i = r.next; continue; }
				if (t[j] === "taxiway") j++;
				tw = readTaxiway(t, j, known);
				if (tw && tw.known) { res.holdShort.push({ type: "taxiway", ref: tw.ref }); i = tw.next; continue; }
				i = j; continue;
			}
			if (w === "cross") {
				j = i + 1;
				if (t[j] === "runway") j++;
				r = readRunway(t, j, known);
				if (r) { res.cross.push(r.ref); i = r.next; continue; }
				i = j; continue;
			}
			if (w === "runway" || (!res.runway && /^\d{1,2}[lrc]?$/.test(w))) {
				r = readRunway(t, w === "runway" ? i + 1 : i, known);
				if (r) { if (!res.runway) res.runway = r.ref; i = r.next; continue; }
			}
			i++;
		}
		if (res.tow) return res;
		if (!res.callsign && !res.tail) {
			var late = readCallsign(t, 0, t.length);
			if (late && !PHONETIC[t[late.start]]) useCallsign(late);
		}
		// Misheard airline ("air berlin four six three") or a number-only callsign
		// ("six seven nine, taxi to..."): keep the flight number so the caller can
		// match it against aircraft at the airport.
		if (!res.callsign && !res.tail) {
			for (var n = 0; n < firstKeyword; n++) {
				var num = readNumber(t, n);
				if (num && num.text.length >= 2 && num.text.length <= 4 && num.text[0] !== "0") { res.flightNumber = num.text; break; }
				if (num) n = num.next - 1;
			}
		}
		return res;
	}

	function dist(a, b) {
		var k = Math.cos((a[0] + b[0]) / 2 * Math.PI / 180);
		var dy = (a[0] - b[0]) * 111320, dx = (a[1] - b[1]) * 111320 * k;
		return Math.sqrt(dx * dx + dy * dy);
	}

	function bearing(a, b) {
		return (Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI + 360) % 360;
	}

	function Heap() { this.a = []; }
	Heap.prototype.push = function (item) {
		var a = this.a, i = a.length;
		a.push(item);
		while (i > 0) {
			var p = (i - 1) >> 1;
			if (a[p][0] <= a[i][0]) break;
			var tmp = a[p]; a[p] = a[i]; a[i] = tmp; i = p;
		}
	};
	Heap.prototype.pop = function () {
		var a = this.a, top = a[0], last = a.pop();
		if (a.length) {
			a[0] = last;
			var i = 0;
			for (;;) {
				var l = 2 * i + 1, r = l + 1, m = i;
				if (l < a.length && a[l][0] < a[m][0]) m = l;
				if (r < a.length && a[r][0] < a[m][0]) m = r;
				if (m === i) break;
				var tmp = a[m]; a[m] = a[i]; a[i] = tmp; i = m;
			}
		}
		return top;
	};

	function Graph(data) {
		var self = this;
		this.coords = data.nodes;
		this.adj = {};
		this.byRef = {};
		this.lines = {};
		this.runways = {};
		var runwayPts = {};
		data.ways.forEach(function (w) {
			var ids = w.nodes.map(String);
			if (w.type === "runway") {
				var r = runwayPts[w.ref] || (runwayPts[w.ref] = {});
				ids.forEach(function (id) { r[id] = true; });
				return;
			}
			var set = w.ref ? (self.byRef[w.ref] || (self.byRef[w.ref] = {})) : null;
			if (w.ref) (self.lines[w.ref] || (self.lines[w.ref] = [])).push(ids.map(function (id) { return self.coords[id]; }));
			for (var i = 0; i < ids.length; i++) {
				if (set) set[ids[i]] = true;
				if (i === 0) continue;
				var a = ids[i - 1], b = ids[i], d = dist(self.coords[a], self.coords[b]);
				(self.adj[a] || (self.adj[a] = [])).push({ to: b, d: d, ref: w.ref });
				(self.adj[b] || (self.adj[b] = [])).push({ to: a, d: d, ref: w.ref });
			}
		});
		Object.keys(runwayPts).forEach(function (ref) {
			var ends = ref.split("/");
			var ids = Object.keys(runwayPts[ref]);
			if (ends.length !== 2) return;
			var best = [ids[0], ids[0]], bestD = -1;
			for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) {
				var d = dist(self.coords[ids[i]], self.coords[ids[j]]);
				if (d > bestD) { bestD = d; best = [ids[i], ids[j]]; }
			}
			var p = self.coords[best[0]], q = self.coords[best[1]];
			var hdg = parseInt(ends[0], 10) * 10;
			if (Math.abs(((bearing(p, q) - hdg + 540) % 360) - 180) > 90) { var tmp = p; p = q; q = tmp; }
			var info = { ref: ref, nodes: runwayPts[ref], line: [p, q] };
			self.runways[ends[0]] = Object.assign({ threshold: p }, info);
			self.runways[ends[1]] = Object.assign({ threshold: q }, info);
		});
	}

	Graph.prototype.known = function () {
		var runways = {};
		Object.keys(this.runways).forEach(function (r) { runways[r] = true; });
		return { taxiways: this.byRef, runways: runways };
	};

	Graph.prototype.nearestNodes = function (pt, radius) {
		var self = this, list = Object.keys(this.adj).map(function (id) {
			return { id: id, d: dist(pt, self.coords[id]) };
		}).sort(function (a, b) { return a.d - b.d; });
		var limit = Math.max(radius, list.length ? list[0].d + 30 : 0);
		return list.filter(function (n) { return n.d <= limit; }).slice(0, 25);
	};

	/**
	 * Shortest path that follows `taxiways` in order.
	 * opts: { start: [lat, lng] | null, runway: "17R" | null, holdShort: [{type, ref}] }
	 * State -1 is the free leg from the aircraft onto the first taxiway; state k
	 * (after the last taxiway) is the free leg to the runway. Free legs cost more
	 * so the route sticks to the cleared taxiways.
	 */
	Graph.prototype.route = function (taxiways, opts) {
		// Departures start near the runway end; only accept a mid-field entry if nothing closer is reachable.
		var r = this.routeOnce(taxiways, opts, 500);
		return r.error && opts.runway ? this.routeOnce(taxiways, opts, Infinity) : r;
	};

	Graph.prototype.routeOnce = function (taxiways, opts, maxEntryFromThreshold) {
		var self = this, seq = taxiways.filter(function (r) { return self.byRef[r]; });
		var k = seq.length;
		var target = opts.runway ? this.runways[opts.runway] : null;
		var stopAt = null;
		if (!target) (opts.holdShort || []).some(function (h) {
			if (h.type === "runway" && self.runways[h.ref]) { stopAt = self.runways[h.ref]; return true; }
		});
		if (!k && !target) return { error: "Need at least one known taxiway or a runway" };
		if (!opts.start && !k) return { error: "Need the aircraft's position to route to a runway with no taxiways" };
		var openEnded = !target && !stopAt;
		// Without a start or an end there is no path to find; show the cleared taxiways instead.
		if (!opts.start && openEnded) return { path: [], holds: [], taxiways: seq, highlight: seq, length: 0 };

		var best = {}, prev = {}, heap = new Heap();
		function push(key, cost, from) {
			if (best[key] === undefined || cost < best[key]) {
				best[key] = cost; prev[key] = from; heap.push([cost, key]);
			}
		}
		var startState = k ? -1 : 0;
		if (opts.start) {
			this.nearestNodes(opts.start, 150).forEach(function (n) { push(n.id + "|" + startState, n.d * 1.5, null); });
		} else if (k) {
			Object.keys(this.byRef[seq[0]]).forEach(function (id) { if (self.adj[id]) push(id + "|0", 0, null); });
		}

		var GOAL = "goal|0";
		while (heap.a.length) {
			var top = heap.pop(), cost = top[0], key = top[1];
			if (cost > best[key]) continue;
			if (key === GOAL) break;
			var sp = key.split("|"), n = sp[0], i = +sp[1];

			if (i + 1 < k && this.byRef[seq[i + 1]][n]) push(n + "|" + (i + 1), cost, key);
			if (i === k - 1 && k > 0) {
				if (openEnded) { push(GOAL, cost, key); continue; }
				push(n + "|" + k, cost, key);
			}
			if (i === k) {
				if (target && target.nodes[n]) {
					var fromThreshold = dist(this.coords[n], target.threshold);
					if (fromThreshold <= maxEntryFromThreshold) push(GOAL, cost + fromThreshold, key);
				}
				if (stopAt && stopAt.nodes[n]) push(GOAL, cost, key);
			}
			var free = i === -1 || i === k;
			(this.adj[n] || []).forEach(function (e) {
				if (free) push(e.to + "|" + i, cost + e.d * (i === -1 ? 1.5 : 2), key);
				else if (e.ref === seq[i]) push(e.to + "|" + i, cost + e.d, key);
			});
		}
		if (best[GOAL] === undefined) return { error: "No route found along " + seq.join(", ") };

		var ids = [], cur = prev[GOAL];
		while (cur) {
			var id = cur.split("|")[0];
			if (ids[0] !== id) ids.unshift(id);
			cur = prev[cur];
		}
		var path = ids.map(function (id) { return self.coords[id]; });
		var holds = [];
		(opts.holdShort || []).forEach(function (h) {
			var set = h.type === "runway" ? (self.runways[h.ref] || {}).nodes : self.byRef[h.ref];
			if (!set) return;
			for (var i = 0; i < ids.length; i++) {
				if (set[ids[i]]) { holds.push({ ref: h.ref, at: path[i], from: path[Math.max(0, i - 1)] }); break; }
			}
		});
		var length = 0;
		for (var p = 1; p < path.length; p++) length += dist(path[p - 1], path[p]);
		return { path: path, holds: holds, taxiways: seq, highlight: openEnded ? [seq[k - 1]] : [], length: length };
	};

	var api = { parse: parse, Graph: Graph, dist: dist, AIRLINES: AIRLINES };
	root.FR24TaxiRoute = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
