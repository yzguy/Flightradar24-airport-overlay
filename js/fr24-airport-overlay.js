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
		listEl
	]);
	document.body.appendChild(state.panel);
	setStatus("Pan or zoom the map once to attach the overlays\u2026");

	function build(map, data) {
		state.map = map;
		setStatus("");
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

	loadData(function (data) {
		captureMap(function (map) { build(map, data); });
	});
})();
