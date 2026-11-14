# Flightradar24-airport-overlay
## An addon for Flightradar24 web

![](https://i.imgur.com/tEJLOxz.jpg)

### Background:
Inspired by [Hong Kong FIR (VHHK) FR24 Overlay](https://github.com/microtony/fr24-overlay-vhhk).

This addon aims to label taxiways, runways and other visual markings on Flightradar24. 

### How to use:

Add the code below as your bookmark/favorite URL.

`javascript:(function(){var r='yzguy/Flightradar24-airport-overlay';function go(v){var s=document.createElement('script');s.id='fr24-airport-overlay';s.src='https://cdn.jsdelivr.net/gh/'+r+'@'+v+'/js/fr24-airport-overlay.js';document.body.appendChild(s);}fetch('https://api.github.com/repos/'+r+'/commits/main').then(function(x){return x.json()}).then(function(j){go(j.sha||'main')},function(){go('main')});})()`

1. Open the Flightradar24 live [map](https://www.flightradar24.com/).
2. Click the bookmark. An "Airport overlays" panel appears.
3. Pan or zoom the map once so the overlays can attach to it.

Click an airport in the panel to zoom to it, untick it to hide it, or use the slider to change opacity. Clicking the bookmark again shows/hides the panel; the × button removes everything. Airport diagrams are about 0.5MB each, so they may take a few seconds to appear.

The bookmark asks GitHub for the latest commit on `main` and loads that exact version from jsDelivr, so changes show up immediately instead of waiting for jsDelivr's 12-hour cache of `@main`. If you host a fork, replace `yzguy` in the URL with your GitHub username. Images and airport data are loaded relative to wherever the script is served from.

### Taxi instructions:

Airports with taxiway data (currently KDFW) get a **Taxi instruction** box in the panel. Type an instruction the way ATC says it, or as shorthand, and press Enter:

```
American 2345, runway 17C, taxi via Kilo, Echo Juliet, hold short of runway 17R
AAL2345 17C via K EJ hold short 17R
```

The addon looks up the aircraft by callsign using [airplanes.live](https://airplanes.live/) ADS-B data, puts a ring around it (updated every few seconds), and draws the route along the named taxiways with red bars at hold-short points. Without a runway or hold short, it routes onto the last taxiway and highlights it; if the aircraft isn't found, it highlights the named taxiways or routes from the first one. Callsigns that are one digit off from a single flight of the same airline are matched to it.

Run `node tools/test_taxi_route.js` to test the instruction parser and router against the KDFW data.

### Listening to ATC audio:

`helper/atc_listen.py` transcribes ATC audio on your Mac with a [Whisper model fine-tuned on ATC speech](https://huggingface.co/jacktol/whisper-medium.en-fine-tuned-for-ATC-faster-whisper) and sends each transmission to the overlay. Click **Listen to ATC helper** in the panel: every transmission is logged, the aircraft being spoken to gets a magenta ring for 15 seconds, and taxi instructions are drawn automatically. Requires [uv](https://docs.astral.sh/uv/) and ffmpeg (`brew install uv ffmpeg`); the first run downloads the model (~3 GB). On Apple Silicon a transmission is transcribed in about 1–1.5 seconds.

To capture what you're listening to (for example LiveATC in your browser), route your Mac's audio through [BlackHole](https://github.com/ExistentialAudio/BlackHole):

1. `brew install blackhole-2ch` (asks for your password).
2. Open **Audio MIDI Setup**, click **+** → **Create Multi-Output Device**, and tick your speakers/headphones and **BlackHole 2ch** (enable **Drift Correction** for BlackHole). You'll still hear the audio.
3. Choose that Multi-Output Device as your sound output (System Settings → Sound → Output). The volume keys don't work with a Multi-Output Device; set the volume in the player instead.
4. Run the helper and leave it running:

```
uv run helper/atc_listen.py --device "BlackHole 2ch"
```

`--list-devices` shows audio input names; `--url` reads any audio stream you have access to, and `--file` replays a recording in real time. `helper/make_test_audio.sh out.wav "American 349, runway 17 center, taxi via Kilo, Echo Juliet."` synthesizes radio-style test audio with macOS voices.

The first time you click **Listen to ATC helper**, Chrome asks whether flightradar24.com may access apps and services on this device; choose **Allow** so the page can reach the helper at `127.0.0.1:8765`. Transcription isn't perfect: callsigns are matched to aircraft near the airport, and a flight number one digit off from a single flight of the same airline is accepted.

### Adding an airport:

`tools/osm_airport_overlay.py` renders a runway/taxiway diagram from [OpenStreetMap](https://www.openstreetmap.org/) data (requires Pillow):

```
python3 tools/osm_airport_overlay.py KDFW
```

It writes `images/airports/<ICAO>.png` and `data/airports/<ICAO>.json` (the taxiway network for taxi instructions), and prints an entry to add to `js/fr24-airport-overlay-data.js`. Diagrams generated this way contain data © OpenStreetMap contributors, available under the [ODbL](https://opendatacommons.org/licenses/odbl/).

### Disclaimer:

Do NOT use this addon for navigation or in a practical way. It is just for entertainment use. 
Some of the maps are not up-to-date and may contain errors.
