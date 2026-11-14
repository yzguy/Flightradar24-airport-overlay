(function () {
	var STATE_KEY = "__fr24AirportOverlay";
	var existing = window[STATE_KEY];
	if (existing && existing.map && document.body.contains(existing.map.getDiv())) {
		existing.togglePanel();
		return;
	}
	if (existing) existing.destroy();

	if (!window.google || !google.maps || !google.maps.Map) {
		alert("FR24 airport overlay: Google Maps not found. Open the Flightradar24 live map first.");
		return;
	}

	var script = document.currentScript || document.getElementById("fr24-airport-overlay");
	var base = window.FR24_AIRPORT_OVERLAY_BASE ||
		(script && script.src ? script.src.replace(/js\/fr24-airport-overlay\.js(\?.*)?$/, "") : "");

	var state = {
		map: null,
		overlays: [],
		opacity: 0.7,
		panel: null,
		unhook: null,
		togglePanel: function () {
			if (state.panel) state.panel.style.display = state.panel.style.display === "none" ? "" : "none";
		},
		destroy: function () {
			if (state.unhook) state.unhook();
			if (state.unhookFeed) state.unhookFeed();
			clearTaxi();
			stopAtc();
			state.overlays.forEach(function (o) { o.setMap(null); });
			if (state.panel) state.panel.remove();
			delete window[STATE_KEY];
		}
	};
	window[STATE_KEY] = state;

	function loadData(cb) {
		if (window.fr24_airport_overlay_data) return cb(window.fr24_airport_overlay_data);
		var s = document.createElement("script");
		// jsDelivr lets browsers cache for a week; always fetch the current list.
		s.src = base + "js/fr24-airport-overlay-data.js?t=" + Date.now();
		s.onload = function () { cb(window.fr24_airport_overlay_data || []); };
		s.onerror = function () { setStatus("Failed to load airport data from " + s.src); };
		document.head.appendChild(s);
	}

	// FR24 keeps its google.maps.Map instance private, so capture it the next
	// time the app calls one of these methods (it does on every pan/zoom).
	function captureMap(cb) {
		var proto = google.maps.Map.prototype;
		var names = ["getBounds", "getZoom", "getCenter", "getProjection"];
		var originals = {};
		var done = false;
		function restore() {
			names.forEach(function (n) { proto[n] = originals[n]; });
			state.unhook = null;
		}
		names.forEach(function (n) {
			originals[n] = proto[n];
			proto[n] = function () {
				if (!done) {
					done = true;
					var m = this;
					restore();
					setTimeout(function () { cb(m); }, 0);
				}
				return originals[n].apply(this, arguments);
			};
		});
		state.unhook = restore;
	}

	// Aircraft Flightradar24 is currently drawing, by callsign, read from the
	// map's own LiveFeed responses (gRPC-web protobuf). Field numbers were
	// worked out from live responses: 2 lat, 3 lon, 4 track, 5 altitude (ft),
	// 6 ground speed (kt), 11 callsign.
	var feed = {};

	function readVarint(b, p) {
		var v = 0, s = 0, c;
		do { c = b[p.i++]; v += (c & 0x7f) * Math.pow(2, s); s += 7; } while (c & 0x80 && p.i < b.length);
		return v;
	}

	function protoFields(b, start, end, cb) {
		var p = { i: start };
		while (p.i < end) {
			var key = readVarint(b, p), f = Math.floor(key / 8), wt = key & 7;
			if (wt === 0) cb(f, wt, readVarint(b, p));
			else if (wt === 5) { cb(f, wt, new DataView(b.buffer, b.byteOffset + p.i, 4).getFloat32(0, true)); p.i += 4; }
			else if (wt === 1) p.i += 8;
			else if (wt === 2) { var len = readVarint(b, p); cb(f, wt, [p.i, p.i + len]); p.i += len; }
			else return;
		}
	}

	function readLiveFeed(buf) {
		var b = new Uint8Array(buf), i = 0, now = Date.now();
		while (i + 5 <= b.length) {
			var flag = b[i], len = new DataView(b.buffer, i + 1, 4).getUint32(0);
			if (!(flag & 0x80)) protoFields(b, i + 5, i + 5 + len, function (f, wt, range) {
				if (f !== 1 || wt !== 2) return;
				var r = {};
				protoFields(b, range[0], range[1], function (g, wt2, v) {
					if (wt2 === 2) { if (g === 11) r.callsign = new TextDecoder().decode(b.subarray(v[0], v[1])); }
					else r[g] = v;
				});
				if (r.callsign && typeof r[2] === "number") {
					feed[r.callsign] = { flight: r.callsign, lat: r[2], lon: r[3], track: r[4], gs: r[6] || 0,
						alt_baro: r[5] ? r[5] : "ground", seen: now };
				}
			});
			i += 5 + len;
		}
	}

	function hookLiveFeed() {
		var proto = XMLHttpRequest.prototype, open = proto.open;
		proto.open = function (method, url) {
			if (String(url).indexOf("Feed/LiveFeed") >= 0) {
				this.addEventListener("load", function () {
					try { if (this.response instanceof ArrayBuffer) readLiveFeed(this.response); } catch (e) { /* format changed; fall back to airplanes.live */ }
				});
			}
			return open.apply(this, arguments);
		};
		state.unhookFeed = function () { proto.open = open; state.unhookFeed = null; };
	}
	hookLiveFeed();

	function feedAircraft() {
		var now = Date.now();
		return Object.keys(feed).map(function (k) { return feed[k]; })
			.filter(function (a) { return now - a.seen < 60000; });
	}

	function el(tag, attrs, children) {
		var e = document.createElement(tag);
		for (var k in attrs || {}) {
			if (k === "style") e.style.cssText = attrs[k];
			else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
			else e[k] = attrs[k];
		}
		(children || []).forEach(function (c) { e.append(c); });
		return e;
	}

	var statusEl = el("div", { style: "margin:6px 0;color:#ffcc66;" });
	var listEl = el("div");
	function setStatus(msg) { statusEl.textContent = msg || ""; statusEl.style.display = msg ? "" : "none"; }

	var taxiInput = el("textarea", {
		rows: 2, placeholder: "AAL2345 runway 17C via K, EJ, hold short 17R",
		style: "width:100%;box-sizing:border-box;margin-top:4px;background:#0d1117;color:#fff;border:1px solid #445;" +
			"border-radius:4px;padding:4px;font:12px/1.3 system-ui,sans-serif;resize:vertical;",
		onkeydown: function (e) {
			if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); showTaxi(taxiInput.value); }
		}
	});
	var taxiStatus = el("div", { style: "margin-top:4px;font-size:12px;color:#cfd8e3;white-space:pre-line;" });
	var atcStatus = el("span", { style: "font-size:12px;color:#8a96a8;" });
	var atcLog = el("div", { style: "margin-top:4px;font-size:12px;max-height:160px;overflow:auto;" });
	var buttonStyle = "background:#2a3446;color:#fff;border:1px solid #445;border-radius:4px;padding:2px 10px;cursor:pointer;";
	var taxiSection = el("div", { style: "display:none;margin-top:10px;padding-top:8px;border-top:1px solid #334;" }, [
		el("div", { style: "font-weight:600;" }, ["Taxi instruction"]),
		taxiInput,
		el("div", { style: "display:flex;gap:6px;margin-top:4px;" }, [
			el("button", { textContent: "Show", style: buttonStyle, onclick: function () { showTaxi(taxiInput.value); } }),
			el("button", { textContent: "Clear", style: buttonStyle, onclick: function () { clearTaxi(); taxiStatus.textContent = ""; } })
		]),
		taxiStatus,
		el("div", { style: "display:flex;align-items:center;gap:6px;margin-top:8px;" }, [
			el("button", { textContent: "Listen to ATC helper", style: buttonStyle, onclick: function () { toggleAtc(this); } }),
			atcStatus
		]),
		atcLog
	]);

	state.panel = el("div", {
		style: "position:fixed;top:80px;left:12px;z-index:2147483647;width:260px;max-height:70vh;overflow:auto;" +
			"background:rgba(20,24,32,0.92);color:#fff;font:13px/1.4 system-ui,sans-serif;padding:10px 12px;" +
			"border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.4);"
	}, [
		el("div", { style: "display:flex;justify-content:space-between;align-items:center;font-weight:600;margin-bottom:4px;" }, [
			"Airport overlays",
			el("button", {
				textContent: "\u00d7", title: "Remove overlays",
				style: "background:none;border:0;color:#fff;font-size:18px;cursor:pointer;line-height:1;",
				onclick: function () { state.destroy(); }
			})
		]),
		el("label", { style: "display:flex;align-items:center;gap:6px;margin:4px 0 8px;" }, [
			"Opacity",
			el("input", {
				type: "range", min: 0, max: 1, step: 0.05, value: state.opacity, style: "flex:1;",
				oninput: function (e) {
					state.opacity = parseFloat(e.target.value);
					state.overlays.forEach(function (o) { o.setOpacity(state.opacity); });
				}
			})
		]),
		statusEl,
		listEl,
		taxiSection
	]);
	// Keep typing in the panel from triggering Flightradar24's keyboard shortcuts.
	["keydown", "keyup", "keypress"].forEach(function (type) {
		state.panel.addEventListener(type, function (e) { e.stopPropagation(); });
	});
	document.body.appendChild(state.panel);
	setStatus("Pan or zoom the map once to attach the overlays\u2026");

	function build(map, data) {
		state.map = map;
		state.data = data;
		setStatus("");
		if (data.some(function (d) { return d.taxiGraph; })) taxiSection.style.display = "";
		data.forEach(function (d) {
			var bounds = new google.maps.LatLngBounds(
				{ lat: d.swBoundLat, lng: d.swBoundLng },
				{ lat: d.neBoundLat, lng: d.neBoundLng }
			);
			var overlay = new google.maps.GroundOverlay(base + "images/airports/" + d.image, bounds, {
				opacity: state.opacity,
				clickable: false,
				map: map
			});
			state.overlays.push(overlay);

			listEl.append(el("div", { style: "display:flex;align-items:center;gap:6px;padding:2px 0;" }, [
				el("input", {
					type: "checkbox", checked: true,
					onchange: function (e) { overlay.setMap(e.target.checked ? map : null); }
				}),
				el("a", {
					href: "#", textContent: d.ICAO + " \u2013 " + d.name, title: "Zoom to " + d.name,
					style: "color:#9fd0ff;text-decoration:none;",
					onclick: function (e) { e.preventDefault(); map.fitBounds(bounds); }
				})
			]));
		});
	}

	var taxi = { overlays: [], marker: null, timer: null, graphs: {} };
	var ROUTE_COLOR = "#00e5ff";

	function clearTaxi() {
		if (taxi.timer) clearInterval(taxi.timer);
		taxi.timer = null;
		taxi.overlays.forEach(function (o) { o.setMap(null); });
		taxi.overlays = [];
		if (taxi.marker) taxi.marker.setMap(null);
		taxi.marker = null;
	}

	function loadScript(src) {
		return new Promise(function (resolve, reject) {
			var s = document.createElement("script");
			s.src = src;
			s.onload = resolve;
			s.onerror = function () { reject(new Error("Failed to load " + src)); };
			document.head.appendChild(s);
		});
	}

	function loadGraph(airport) {
		if (taxi.graphs[airport.ICAO]) return Promise.resolve(taxi.graphs[airport.ICAO]);
		var ready = window.FR24TaxiRoute ? Promise.resolve() : loadScript(base + "js/fr24-taxi-route.js");
		return ready.then(function () {
			return fetch(base + "data/airports/" + airport.taxiGraph);
		}).then(function (r) {
			if (!r.ok) throw new Error("Failed to load taxiways for " + airport.ICAO);
			return r.json();
		}).then(function (json) {
			return (taxi.graphs[airport.ICAO] = new FR24TaxiRoute.Graph(json));
		});
	}

	function airportCenter(d) {
		return { lat: (d.neBoundLat + d.swBoundLat) / 2, lng: (d.neBoundLng + d.swBoundLng) / 2 };
	}

	function currentAirport() {
		var c = state.map.getCenter(), best = null, bestD = Infinity;
		state.data.forEach(function (d) {
			if (!d.taxiGraph) return;
			var a = airportCenter(d), dd = Math.pow(a.lat - c.lat(), 2) + Math.pow(a.lng - c.lng(), 2);
			if (dd < bestD) { bestD = dd; best = d; }
		});
		return best;
	}

	// airplanes.live allows about one request per second; share results briefly.
	var aircraftCache = {};
	function fetchAircraft(airport) {
		var cached = aircraftCache[airport.ICAO];
		if (cached && Date.now() - cached.t < 2000) return cached.promise;
		var c = airportCenter(airport);
		var promise = fetch("https://api.airplanes.live/v2/point/" + c.lat.toFixed(4) + "/" + c.lng.toFixed(4) + "/8")
			.then(function (r) { if (!r.ok) throw new Error("airplanes.live returned " + r.status); return r.json(); })
			.then(function (j) { return j.ac || []; });
		aircraftCache[airport.ICAO] = { t: Date.now(), promise: promise };
		promise.catch(function () { delete aircraftCache[airport.ICAO]; });
		return promise;
	}

	function editDistance(a, b) {
		var row = [];
		for (var j = 0; j <= b.length; j++) row[j] = j;
		for (var i = 1; i <= a.length; i++) {
			var prev = row[0];
			row[0] = i;
			for (j = 1; j <= b.length; j++) {
				var tmp = row[j];
				row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
				prev = tmp;
			}
		}
		return row[b.length];
	}

	// Transcribed or typed flight numbers are often one digit off; accept a
	// unique near match from the same airline.
	function findAircraft(list, callsign, exactOnly) {
		var ids = function (a) { return [(a.flight || "").trim().toUpperCase(), (a.r || "").replace(/-/g, "").toUpperCase()]; };
		var exact = list.filter(function (a) { return ids(a).indexOf(callsign) >= 0; });
		if (exact.length) return { ac: exact[0], exact: true };
		if (exactOnly) return null;
		var near = list.filter(function (a) {
			var f = ids(a)[0];
			return f && f.slice(0, 3) === callsign.slice(0, 3) && editDistance(f, callsign) === 1;
		});
		return near.length === 1 ? { ac: near[0], exact: false } : null;
	}

	// Turns what the parser heard into a callsign to look up, using the aircraft near
	// the airport to choose between letter-suffix variants (ETD90M vs ETD90) and to
	// complete abbreviated tails ("Cessna 3AB" -> N123AB) or bare flight numbers
	// ("air berlin 463" -> AAL463). Resolves to { callsign, note } or null.
	// The ATC speech model often hears US airlines as European ones ("American" as
	// "Air Berlin"), so a heard callsign that isn't near the airport falls back to
	// the flight number.
	function resolveCallsign(airport, parsed) {
		var heardNumber = parsed.callsign && (/^[A-Z]{3}(\d{1,4})/.exec(parsed.callsign) || [])[1];
		var number = parsed.flightNumber || heardNumber;
		if (!parsed.callsign && !parsed.tail && !number) return Promise.resolve(null);
		return fetchAircraft(airport).catch(function () { return []; }).then(function (list) {
			var all = feedAircraft().concat(list);
			if (parsed.callsign) {
				var hit = (parsed.callsignOptions || [parsed.callsign]).filter(function (c) { return findAircraft(all, c, true); })[0];
				if (hit) return { callsign: hit };
			}
			var hits = {};
			all.forEach(function (a) {
				var flight = (a.flight || "").trim().toUpperCase(), reg = (a.r || "").replace(/-/g, "").toUpperCase();
				if (parsed.tail) {
					if (reg && reg.slice(-parsed.tail.length) === parsed.tail) hits[reg] = true;
					else if (/^N\d/.test(flight) && flight.slice(-parsed.tail.length) === parsed.tail) hits[flight] = true;
				} else if (number) {
					var m = /^[A-Z]{3}(\d{1,4})[A-Z]{0,2}$/.exec(flight);
					if (m && m[1] === number) hits[flight] = true;
				}
			});
			var ids = Object.keys(hits);
			if (ids.length !== 1) return parsed.callsign ? { callsign: parsed.callsign } : null;
			return {
				callsign: ids[0],
				note: parsed.tail ? "matched tail \u2026" + parsed.tail + " to " + ids[0]
					: parsed.callsign ? "heard " + parsed.callsign + ", not nearby; matched flight number to " + ids[0]
					: "airline not recognized; matched flight number " + number + " to " + ids[0]
			};
		});
	}

	// Prefer what Flightradar24 is drawing; airplanes.live covers aircraft
	// outside the current view. An exact callsign from either source beats a near match.
	function locate(airport, callsign) {
		var onMap = feedAircraft();
		var hit = findAircraft(onMap, callsign, true);
		if (hit) return Promise.resolve(Object.assign(hit, { source: "Flightradar24" }));
		return fetchAircraft(airport).catch(function () { return []; }).then(function (list) {
			var h = findAircraft(list, callsign, true);
			if (h) return Object.assign(h, { source: "airplanes.live" });
			h = findAircraft(onMap, callsign);
			if (h) return Object.assign(h, { source: "Flightradar24" });
			h = findAircraft(list, callsign);
			return h ? Object.assign(h, { source: "airplanes.live" }) : null;
		});
	}

	function onGround(ac) { return ac.alt_baro === "ground" || (typeof ac.gs === "number" && ac.gs < 40 && ac.alt_baro < 1500); }

	function offset(p, dxMetres, dyMetres) {
		return [p[0] + dyMetres / 111320, p[1] + dxMetres / (111320 * Math.cos(p[0] * Math.PI / 180))];
	}

	function drawLine(points, opts) {
		var line = new google.maps.Polyline(Object.assign({
			path: points.map(function (p) { return { lat: p[0], lng: p[1] }; }),
			clickable: false, map: state.map
		}, opts));
		taxi.overlays.push(line);
		return line;
	}

	// Red bar across the route, a little before the runway/taxiway it holds short of.
	function drawHold(h) {
		var dy = (h.at[0] - h.from[0]) * 111320;
		var dx = (h.at[1] - h.from[1]) * 111320 * Math.cos(h.at[0] * Math.PI / 180);
		var len = Math.sqrt(dx * dx + dy * dy);
		if (!len) return;
		dx /= len; dy /= len;
		var c = offset(h.at, -dx * Math.min(70, len), -dy * Math.min(70, len));
		drawLine([offset(c, -dy * 40, dx * 40), offset(c, dy * 40, -dx * 40)],
			{ strokeColor: "#ff3030", strokeOpacity: 1, strokeWeight: 7, zIndex: 1000 });
	}

	function placeMarker(ac) {
		var pos = { lat: ac.lat, lng: ac.lon };
		if (taxi.marker) return taxi.marker.setPosition(pos);
		taxi.marker = new google.maps.Marker({
			position: pos, map: state.map, clickable: false, zIndex: 1000000,
			icon: {
				path: google.maps.SymbolPath.CIRCLE, scale: 22, strokeColor: ROUTE_COLOR, strokeWeight: 3,
				fillColor: ROUTE_COLOR, fillOpacity: 0.15
			}
		});
	}

	function showTaxi(text) {
		if (!text.trim()) return;
		var airport = currentAirport();
		if (!airport) { taxiStatus.textContent = "No airport with taxiway data in the list."; return; }
		clearTaxi();
		taxiStatus.textContent = "Working\u2026";
		var graph, parsed;
		loadGraph(airport).then(function (g) {
			graph = g;
			parsed = FR24TaxiRoute.parse(text, graph.known());
			return resolveCallsign(airport, parsed).then(function (r) {
				if (r && r.note) parsed.warnings.push(r.note.charAt(0).toUpperCase() + r.note.slice(1));
				return (parsed.callsign = r ? r.callsign : null);
			});
		}).then(function (callsign) {
			return callsign ? locate(airport, callsign) : null;
		}).then(function (found) {
			var ac = found && found.ac;
			var start = ac && onGround(ac) ? [ac.lat, ac.lon] : null;
			var result = graph.route(parsed.taxiways, { start: start, runway: parsed.runway, holdShort: parsed.holdShort });

			var lines = [];
			if (parsed.callsign) {
				if (!ac) lines.push(parsed.callsign + ": not found on the map or airplanes.live. Zoom the map to " +
					airport.ICAO + " so Flightradar24 loads it (route start is approximate).");
				else {
					var name = (ac.flight || ac.r || "").trim();
					lines.push(name + (found.exact ? "" : " (closest match to " + parsed.callsign + ")") +
						(onGround(ac) ? " \u2013 on the ground" : " \u2013 airborne, " + ac.alt_baro + " ft"));
				}
			}
			var summary = (parsed.runway ? "Runway " + parsed.runway + " " : "") +
				(parsed.taxiways.length ? "via " + parsed.taxiways.join(" \u2192 ") : "");
			if (summary) lines.push(summary);
			if (parsed.holdShort.length) lines.push("Hold short " + parsed.holdShort.map(function (h) { return h.ref; }).join(", "));
			if (parsed.cross.length) lines.push("Cross " + parsed.cross.join(", "));
			if (result.error) lines.push("\u26a0 " + result.error);
			else if (result.length) lines.push((result.length / 1000).toFixed(1) + " km");
			parsed.warnings.forEach(function (w) { lines.push("\u26a0 " + w); });
			taxiStatus.textContent = lines.join("\n");

			if (!result.error) {
				(result.highlight || []).forEach(function (ref) {
					(graph.lines[ref] || []).forEach(function (pts) {
						drawLine(pts, {
							strokeOpacity: 0, zIndex: 900,
							icons: [{ icon: { path: "M 0,-1 0,1", strokeColor: ROUTE_COLOR, strokeOpacity: 1, scale: 4 }, offset: "0", repeat: "14px" }]
						});
					});
				});
				if (result.path.length > 1) {
					if (start) drawLine([start, result.path[0]], {
						strokeOpacity: 0, zIndex: 951,
						icons: [{ icon: { path: "M 0,-1 0,1", strokeColor: ROUTE_COLOR, strokeOpacity: 1, scale: 3 }, offset: "0", repeat: "10px" }]
					});
					drawLine(result.path, { strokeColor: "#002b33", strokeOpacity: 0.9, strokeWeight: 10, zIndex: 950 });
					drawLine(result.path, {
						strokeColor: ROUTE_COLOR, strokeOpacity: 1, strokeWeight: 5, zIndex: 951,
						icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: "#002b33", fillColor: ROUTE_COLOR, fillOpacity: 1 }, offset: "40px", repeat: "120px" }]
					});
				}
				result.holds.forEach(drawHold);
			}
			if (ac) {
				placeMarker(ac);
				var tracked = (ac.flight || "").trim().toUpperCase() || parsed.callsign;
				taxi.timer = setInterval(function () {
					locate(airport, tracked).then(function (f) { if (f && f.exact) placeMarker(f.ac); }).catch(function () {});
				}, 3000);
				setTimeout(function () { if (taxi.timer) { clearInterval(taxi.timer); taxi.timer = null; } }, 20 * 60 * 1000);
			}
		}).catch(function (err) {
			taxiStatus.textContent = "\u26a0 " + err.message;
		});
	}

	var ATC_URL = "http://127.0.0.1:8765/events";
	var SPEAKER_COLOR = "#ff4fd8";
	var atc = { source: null, button: null, speaker: null, speakerTimer: null, retry: null };

	function setAtcStatus(text, color) { atcStatus.textContent = text; atcStatus.style.color = color || "#8a96a8"; }

	function toggleAtc(button) {
		atc.button = button;
		if (atc.source) stopAtc(); else startAtc();
	}

	function startAtc() {
		var source = atc.source = new EventSource(ATC_URL);
		if (atc.button) atc.button.textContent = "Stop listening";
		setAtcStatus("connecting\u2026");
		source.onopen = function () { setAtcStatus("\u25cf connected", "#5fd38d"); };
		source.onerror = function () {
			setAtcStatus("Can't reach the helper. Is atc_listen.py running? If your browser asked whether this site " +
				"may access apps on this device, choose Allow. Retrying\u2026", "#ffcc66");
			// A refused connection closes the EventSource for good instead of retrying.
			if (source.readyState === EventSource.CLOSED) {
				atc.retry = setTimeout(function () { if (atc.source === source) startAtc(); }, 5000);
			}
		};
		source.onmessage = function (e) { onTransmission(JSON.parse(e.data)); };
	}

	function stopAtc() {
		if (atc.retry) clearTimeout(atc.retry);
		if (atc.source) atc.source.close();
		atc.source = null;
		if (atc.button) atc.button.textContent = "Listen to ATC helper";
		setAtcStatus("");
		clearSpeaker();
	}

	function clearSpeaker() {
		if (atc.speakerTimer) clearTimeout(atc.speakerTimer);
		if (atc.speaker) atc.speaker.setMap(null);
		atc.speaker = atc.speakerTimer = null;
	}

	function addLog(text, parsed) {
		var time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
		var note = el("span", { style: "color:#8a96a8;" });
		note.label = el("span", { textContent: parsed && parsed.callsign ? parsed.callsign + " " : "", style: "color:" + SPEAKER_COLOR + ";font-weight:600;" });
		var entry = el("div", { style: "padding:3px 0;border-bottom:1px solid #263041;" }, [
			el("span", { textContent: time + " ", style: "color:#8a96a8;" }),
			note.label,
			text + " ",
			note
		]);
		atcLog.prepend(entry);
		while (atcLog.children.length > 8) atcLog.lastChild.remove();
		return note;
	}

	// Ring the aircraft that was just spoken to; it fades after 15 s.
	function highlightSpeaker(airport, callsign, note) {
		locate(airport, callsign).then(function (found) {
			if (!found) { note.textContent = "(not found near " + airport.ICAO + ")"; return; }
			if (!found.exact) note.textContent = "(\u2248 " + (found.ac.flight || "").trim() + ")";
			clearSpeaker();
			atc.speaker = new google.maps.Marker({
				position: { lat: found.ac.lat, lng: found.ac.lon }, map: state.map, clickable: false, zIndex: 1000001,
				icon: { path: google.maps.SymbolPath.CIRCLE, scale: 30, strokeColor: SPEAKER_COLOR, strokeWeight: 3, fillOpacity: 0 }
			});
			atc.speakerTimer = setTimeout(clearSpeaker, 15000);
		}).catch(function (err) { note.textContent = "(" + err.message + ")"; });
	}

	function onTransmission(msg) {
		var airport = currentAirport();
		if (!airport) { addLog(msg.text, null); return; }
		loadGraph(airport).then(function (graph) {
			var parsed = FR24TaxiRoute.parse(msg.text, graph.known());
			var note = addLog(msg.text, parsed);
			resolveCallsign(airport, parsed).then(function (r) {
				if (!r) {
					note.textContent = parsed.tail ? "(no single aircraft nearby with a tail ending " + parsed.tail + ")"
						: parsed.flightNumber ? "(no aircraft nearby with flight number " + parsed.flightNumber + ")"
						: "(no callsign recognized)";
					return;
				}
				var callsign = r.callsign;
				note.label.textContent = callsign + " ";
				if (r.note) note.textContent = "(" + r.note + ")";
				// Readbacks repeat the route without "taxi"/"via"; only redraw for the instruction itself.
				if (parsed.taxiways.length && /\b(taxi|via|turn|continue)\b/i.test(msg.text)) {
					taxiInput.value = msg.text;
					showTaxi(msg.text);
				}
				highlightSpeaker(airport, callsign, note);
			});
		});
	}

	loadData(function (data) {
		captureMap(function (map) { build(map, data); });
	});
})();
