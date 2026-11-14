# Flightradar24-airport-overlay
## An addon for Flightradar24 web

![](https://i.imgur.com/tEJLOxz.jpg)

### Background:
Inspired by [Hong Kong FIR (VHHK) FR24 Overlay](https://github.com/microtony/fr24-overlay-vhhk).

This addon aims to label taxiways, runways and other visual markings on Flightradar24. 

### How to use:

Add the code below as your bookmark/favorite URL.

`javascript:(function(){var s=document.createElement('script');s.id='fr24-airport-overlay';s.src='https://cdn.jsdelivr.net/gh/yzguy/Flightradar24-airport-overlay@main/js/fr24-airport-overlay.js';document.body.appendChild(s);})()`

1. Open the Flightradar24 live [map](https://www.flightradar24.com/).
2. Click the bookmark. An "Airport overlays" panel appears.
3. Pan or zoom the map once so the overlays can attach to it.

Click an airport in the panel to zoom to it, untick it to hide it, or use the slider to change opacity. Clicking the bookmark again shows/hides the panel; the × button removes everything. Airport diagrams are about 0.5MB each, so they may take a few seconds to appear.

If you host a fork, replace `yzguy` in the URL with your GitHub username. Images and airport data are loaded relative to wherever the script is served from. jsDelivr caches `@main` for up to 12 hours; use `@<commit-sha>` to pick up changes immediately.

### Adding an airport:

`tools/osm_airport_overlay.py` renders a runway/taxiway diagram from [OpenStreetMap](https://www.openstreetmap.org/) data (requires Pillow):

```
python3 tools/osm_airport_overlay.py KDFW
```

It writes `images/airports/<ICAO>.png` and prints an entry to add to `js/fr24-airport-overlay-data.js`. Diagrams generated this way contain data © OpenStreetMap contributors, available under the [ODbL](https://opendatacommons.org/licenses/odbl/).

### Disclaimer:

Do NOT use this addon for navigation or in a practical way. It is just for entertainment use. 
Some of the maps are not up-to-date and may contain errors.
