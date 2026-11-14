// Usage: node tools/test_taxi_route.js
const assert = require("assert");
const path = require("path");
const { parse, Graph, dist } = require("../js/fr24-taxi-route.js");

const graph = new Graph(require(path.join(__dirname, "../data/airports/KDFW.json")));
const known = graph.known();

const parseCases = [
	["AAL2345 17R via K EJ hold short 17C",
		{ callsign: "AAL2345", runway: "17R", taxiways: ["K", "EJ"], holdShort: ["17C"] }],
	["American 2345, runway 17R, taxi via Kilo, Echo Juliet, hold short of runway 17C",
		{ callsign: "AAL2345", runway: "17R", taxiways: ["K", "EJ"], holdShort: ["17C"] }],
	["american twenty three forty five runway one seven right taxi via kilo echo juliet",
		{ callsign: "AAL2345", runway: "17R", taxiways: ["K", "EJ"], holdShort: [] }],
	["Envoy 3401 runway 18L taxi via Echo, Whiskey Kilo",
		{ callsign: "ENY3401", runway: "18L", taxiways: ["E", "WK"], holdShort: [] }],
	["Delta 1180, runway 36R, taxi via Alpha, Bravo, Echo-Lima",
		{ callsign: "DAL1180", runway: "36R", taxiways: ["A", "B", "EL"], holdShort: [] }],
	["Southwest 12 turn right Lima 2 then Kilo, hold short of Echo Juliet",
		{ callsign: "SWA12", runway: null, taxiways: ["L2", "K"], holdShort: ["EJ"] }],
	// Transcriber output style: lowercase, no punctuation, numbers in words.
	["envoy three thousand four hundred one runway eighteen left taxi via echo whiskey kilo",
		{ callsign: "ENY3401", runway: "18L", taxiways: ["E", "WK"], holdShort: [] }],
	["southwest twelve turn right lima two then kilo hold short of echo juliett",
		{ callsign: "SWA12", runway: null, taxiways: ["L2", "K"], holdShort: ["EJ"] }],
	["Delta twelve hundred runway three five left taxi via kilo ten",
		{ callsign: "DAL1200", runway: "35L", taxiways: ["K10"], holdShort: [] }],
	// Verbatim output of the ATC model on helper/make_test_audio.sh recordings.
	["Spirit one thousand four hundred forty two runway thirty five right taxi via alfa bravo hold short of runway thirty five left",
		{ callsign: "NKS1442", runway: "35R", taxiways: ["A", "B"], holdShort: ["35L"] }],
	["united five hundred and one cross runway seventeen right then taxi via mike kilo seven",
		{ callsign: "UAL501", runway: null, taxiways: ["M", "K7"], holdShort: [] }],
	["frontier two thousand two hundred ten turn left quebec ten taxi to the ramp via quebec echo juliett",
		{ callsign: "FFT2210", runway: null, taxiways: ["Q10", "Q", "EJ"], holdShort: [] }],
	["UAL501 via Q10 Q hold short 17L",
		{ callsign: "UAL501", runway: null, taxiways: ["Q10", "Q"], holdShort: ["17L"] }],
];
// Real (badly heard) DFW ground transcripts: misheard airline, or number-only callsign.
for (const [text, want] of [
	["air berlin four six three dsw ground check your squawk taxi via golf whiskey golf cross runway one eight left", "463"],
	["six seven nine taxi to hotel alfa hotel alfa nine six seven nine", "679"],
	["direct golf whiskey golf cross one eight left for one eight right", undefined],
	// Live KJFK transcripts: prefer the number in callsign position or marked heavy.
	["november mike charlie left on three one seven ryan air six nine five", "695"],
	["bratislava nine fifty three heavy continue november mike charlie left one three one left", "953"],
	["Americans on 953 heavy, continue November. Mike Charlie, left on 3-1 left.", "953"],
]) {
	const got = parse(text, known);
	assert.strictEqual(got.callsign, null, `no airline callsign in ${JSON.stringify(text)}`);
	assert.strictEqual(got.flightNumber, want, `flight number in ${JSON.stringify(text)}`);
	console.log("ok flight number:", text, "->", got.flightNumber);
}
// Maintenance tows, as the ATC model actually transcribed them at KATL.
for (const [text, ship] of [
	["delta main is ninety five thirty one ground", "9531"],
	["ground delta main is 95 to 71 we are here at spot two north looking to taxi to the tsc", "95"],
	["for maintence ninety five seventy one right on foxtrot echo to the csa", "9571"],
	["Delta maintenance ninety five thirty one ground", "9531"],
	["copy that alfa five delta maina three one forty nine", "3149"],
	["delta munich one forty nine via hotel", "149"],
	["Hey ground, Delta Main is 9571, we're here at spot 2 north, looking to taxi to the TFC.", "9571"],
]) {
	const got = parse(text, known);
	assert.ok(got.tow, `tow in ${JSON.stringify(text)}`);
	assert.strictEqual(got.tow.ship, ship, `tow ship in ${JSON.stringify(text)}`);
	assert.ok(!got.callsign && !got.flightNumber, `tow must not match a flight: ${JSON.stringify(text)}`);
	console.log("ok tow:", text, "->", ship);
}
// Callsign letter suffixes, tail numbers and the wider airline list.
for (const [text, want] of [
	["etihad nine zero mike heavy runway one seven center taxi via kilo",
		{ callsign: "ETD90", options: ["ETD90M", "ETD90"], tail: undefined, taxiways: ["K"] }],
	["speedbird two one alfa bravo taxi via kilo",
		{ callsign: "BAW21", options: ["BAW21AB", "BAW21A", "BAW21"], tail: undefined, taxiways: ["K"] }],
	["delta two hundred heavy runway one seven center taxi via kilo",
		{ callsign: "DAL200", options: undefined, tail: undefined, taxiways: ["K"] }],
	["lot five november heavy turn right kilo cross runway three one left",
		{ callsign: "LOT5", options: ["LOT5N", "LOT5"], tail: undefined, taxiways: ["K"] }],
	["american twelve thirty four november",
		{ callsign: "AAL1234", options: undefined, tail: undefined, taxiways: [] }],
	["american twelve thirty four echo juliett",
		{ callsign: "AAL1234", options: ["AAL1234EJ", "AAL1234E", "AAL1234"], tail: undefined, taxiways: [] }],
	["november one two three alfa bravo taxi via kilo",
		{ callsign: "N123AB", options: undefined, tail: undefined, taxiways: ["K"] }],
	["november five six seven eight nine taxi via kilo",
		{ callsign: "N56789", options: undefined, tail: undefined, taxiways: ["K"] }],
	["cessna three alfa bravo taxi via kilo",
		{ callsign: null, options: undefined, tail: "3AB", taxiways: ["K"] }],
	["king air four five zulu runway one seven center taxi via kilo",
		{ callsign: null, options: undefined, tail: "45Z", taxiways: ["K"] }],
	["frontier flight twelve ten taxi via kilo",
		{ callsign: "FFT1210", options: undefined, tail: undefined, taxiways: ["K"] }],
	["copa three forty one taxi via kilo",
		{ callsign: "CMP341", options: undefined, tail: undefined, taxiways: ["K"] }],
]) {
	const got = parse(text, known);
	const summary = { callsign: got.callsign, options: got.callsignOptions, tail: got.tail, taxiways: got.taxiways };
	assert.deepStrictEqual(summary, want, `parse(${JSON.stringify(text)})`);
	assert.strictEqual(got.flightNumber, undefined, `no flight-number fallback in ${JSON.stringify(text)}`);
	console.log("ok callsign:", text, "->", JSON.stringify(summary));
}

for (const [text, want] of parseCases) {
	const got = parse(text, known);
	const summary = {
		callsign: got.callsign, runway: got.runway, taxiways: got.taxiways,
		holdShort: got.holdShort.map((h) => h.ref),
	};
	assert.deepStrictEqual(summary, want, `parse(${JSON.stringify(text)})`);
	console.log("ok parse:", text, "->", JSON.stringify(summary));
}

function check(name, taxiways, opts, expect) {
	const r = graph.route(taxiways, opts);
	assert.ok(!r.error, `${name}: ${r.error}`);
	assert.ok(r.path.length > 1, `${name}: empty path`);
	if (opts.start) assert.ok(dist(opts.start, r.path[0]) < 200, `${name}: route starts ${dist(opts.start, r.path[0]).toFixed(0)}m from aircraft`);
	if (opts.runway) {
		const thr = graph.runways[opts.runway].threshold;
		const d = dist(r.path[r.path.length - 1], thr);
		assert.ok(d < (expect.endWithin || 600), `${name}: ends ${d.toFixed(0)}m from ${opts.runway} threshold`);
	}
	assert.strictEqual(r.holds.length, (opts.holdShort || []).length, `${name}: hold-short markers`);
	console.log(`ok route: ${name} -> ${r.path.length} points, ${(r.length / 1000).toFixed(2)} km, holds ${r.holds.map((h) => h.ref).join(",") || "none"}`);
}

// Aircraft positions are real ground positions seen near DFW's terminals.
check("east side to 17C via K, EJ, hold short 17R", ["K", "EJ"],
	{ start: [32.894886, -97.036427], runway: "17C", holdShort: [{ type: "runway", ref: "17R" }] }, {});
check("east side to 17R via K", ["K"],
	{ start: [32.894886, -97.036427], runway: "17R" }, {});
check("west side to 18L via E", ["E"],
	{ start: [32.889587, -97.048938], runway: "18L" }, {});
const noPos = graph.route(["K", "EJ"], { start: null, runway: null });
assert.deepStrictEqual([noPos.path.length, noPos.highlight], [0, ["K", "EJ"]], "no position, no runway: highlight only");
assert.ok(graph.lines.K.length && graph.lines.EJ.length, "taxiway geometry available for highlighting");
console.log("ok route: no aircraft position, K then EJ -> highlights K, EJ");
const arrival = graph.route(["EJ", "K"], { start: [32.9055, -97.0215], runway: null });
assert.ok(!arrival.error && arrival.path.length > 1 && arrival.highlight[0] === "K", "arrival via EJ, K: " + arrival.error);
console.log(`ok route: arrival via EJ, K -> ${arrival.path.length} points then highlights K`);
check("no aircraft position, to 17C via EJ", ["EJ"], { start: null, runway: "17C" }, {});
check("runway only, from east side", [],
	{ start: [32.898432, -97.035384], runway: "17C" }, { endWithin: 2500 });

const bad = graph.route(["ZZ"], { start: null, runway: null });
assert.ok(bad.error, "unknown taxiway should error");
console.log("ok error:", bad.error);
console.log("all tests passed");
