#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10,<3.14"
# dependencies = ["faster-whisper>=1.1", "numpy"]
# ///
"""Transcribe ATC audio locally and stream the transcripts to the FR24 overlay.

  uv run helper/atc_listen.py --list-devices
  uv run helper/atc_listen.py --device "BlackHole 2ch"
  uv run helper/atc_listen.py --url https://example.com/stream.mp3
  uv run helper/atc_listen.py --file recording.mp3        # replayed in real time

Audio is split into transmissions at the gaps between them, transcribed with a
Whisper model fine-tuned on ATC speech, and served as Server-Sent Events at
http://127.0.0.1:8765/events. Requires ffmpeg.
"""
import argparse
import json
import math
import os
import queue
import subprocess
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

SAMPLE_RATE = 16000
FRAME = 480  # 30 ms
FRAME_S = FRAME / SAMPLE_RATE
DEFAULT_MODEL = "jacktol/whisper-medium.en-fine-tuned-for-ATC-faster-whisper"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Whisper tends to "hear" these in static and silence.
HALLUCINATIONS = {"", "you", "thank you", "thanks", "thanks for watching", "bye", "okay", "uh", "um"}

PHONETIC = {
    "A": "Alpha", "B": "Bravo", "C": "Charlie", "D": "Delta", "E": "Echo", "F": "Foxtrot", "G": "Golf",
    "H": "Hotel", "I": "India", "J": "Juliet", "K": "Kilo", "L": "Lima", "M": "Mike", "N": "November",
    "O": "Oscar", "P": "Papa", "Q": "Quebec", "R": "Romeo", "S": "Sierra", "T": "Tango", "U": "Uniform",
    "V": "Victor", "W": "Whiskey", "X": "X-ray", "Y": "Yankee", "Z": "Zulu",
}
SIDES = {"L": "Left", "R": "Right", "C": "Center"}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, file=sys.stderr, flush=True)


def airport_prompt(icao):
    """Bias the model toward this airport's runway and taxiway names."""
    path = os.path.join(REPO, "data", "airports", f"{icao}.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        g = json.load(f)
    runways = sorted({end for w in g["ways"] if w["type"] == "runway" for end in w["ref"].split("/") if end})
    taxiways = sorted({w["ref"] for w in g["ways"] if w["type"] == "taxiway" and w["ref"].isalpha() and len(w["ref"]) <= 2})

    def say_runway(r):
        num, side = r.rstrip("LRC"), r[len(r.rstrip("LRC")):]
        return f"{int(num)} {SIDES[side]}" if side else str(int(num))

    return (
        "Speedbird 21, runway 13 Left, taxi via Golf, Hotel, hold short of runway 13 Right. "
        f"Runways {', '.join(say_runway(r) for r in runways)}. "
        f"Taxiways {', '.join(' '.join(PHONETIC[c] for c in t) for t in taxiways[:30])}."
    )


class Hub:
    """Fans transcripts out to connected overlay clients."""

    def __init__(self):
        self.lock = threading.Lock()
        self.clients = set()
        self.recent = deque(maxlen=5)
        self.count = 0

    def publish(self, msg):
        with self.lock:
            self.count += 1
            msg["id"] = self.count
            self.recent.append(msg)
            for q in self.clients:
                q.put(msg)

    def subscribe(self):
        q = queue.Queue()
        with self.lock:
            self.clients.add(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            self.clients.discard(q)


def make_handler(hub, status):
    class Handler(BaseHTTPRequestHandler):
        def cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "*")
            # Chrome's Private/Local Network Access preflight for public site -> localhost.
            self.send_header("Access-Control-Allow-Private-Network", "true")

        def do_OPTIONS(self):
            self.send_response(204)
            self.cors()
            self.end_headers()

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/status":
                body = json.dumps(dict(status, transcripts=hub.count, clients=len(hub.clients))).encode()
                self.send_response(200)
                self.cors()
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if path != "/events":
                self.send_error(404)
                return
            self.send_response(200)
            self.cors()
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            q = hub.subscribe()
            log("overlay connected")
            try:
                self.wfile.write(b"retry: 3000\n\n")
                self.wfile.flush()
                while True:
                    try:
                        msg = q.get(timeout=15)
                        self.wfile.write(f"id: {msg['id']}\ndata: {json.dumps(msg)}\n\n".encode())
                    except queue.Empty:
                        self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                hub.unsubscribe(q)
                log("overlay disconnected")

        def log_message(self, *args):
            pass

    return Handler


class Segmenter:
    """Splits a continuous stream into transmissions using an adaptive energy gate."""

    def __init__(self, on_segment, threshold_db=None, margin_db=12, floor_db=-45,
                 hang_s=0.8, min_s=0.6, max_s=25, preroll_s=0.3):
        self.on_segment = on_segment
        self.threshold_db, self.margin_db, self.floor_db = threshold_db, margin_db, floor_db
        self.hang = int(hang_s / FRAME_S)
        self.min_frames = int(min_s / FRAME_S)
        self.max_frames = int(max_s / FRAME_S)
        self.levels = deque(maxlen=int(10 / FRAME_S))
        self.pre = deque(maxlen=int(preroll_s / FRAME_S))
        self.buf, self.active, self.silent, self.run, self.voiced = [], False, 0, 0, 0
        self.t0 = 0.0

    def threshold(self):
        if self.threshold_db is not None:
            return self.threshold_db
        if len(self.levels) < 30:
            return self.floor_db
        return max(float(np.percentile(self.levels, 20)) + self.margin_db, self.floor_db)

    def feed(self, frame):
        rms = float(np.sqrt(np.mean(frame * frame)))
        level = 20 * math.log10(rms + 1e-9)
        self.levels.append(level)
        voiced = level > self.threshold()
        if not self.active:
            self.pre.append(frame)
            self.run = self.run + 1 if voiced else 0
            if self.run >= 3:
                self.active, self.buf, self.silent, self.voiced = True, list(self.pre), 0, self.run
                self.t0 = time.time() - len(self.buf) * FRAME_S
            return
        self.buf.append(frame)
        if voiced:
            self.silent = 0
            self.voiced += 1
        else:
            self.silent += 1
        if self.silent >= self.hang or len(self.buf) >= self.max_frames:
            self.flush()

    def flush(self):
        if self.active and self.voiced >= self.min_frames:
            keep = len(self.buf) - max(0, self.silent - int(0.2 / FRAME_S))
            self.on_segment(np.concatenate(self.buf[:keep]), self.t0)
        self.active, self.buf, self.silent, self.run, self.voiced = False, [], 0, 0, 0
        self.pre.clear()


def input_devices():
    out = subprocess.run(["ffmpeg", "-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
                         capture_output=True, text=True).stderr
    return [line.split("] ", 2)[2] for line in out.split("audio devices:")[-1].splitlines() if "] [" in line]


def ffmpeg_cmd(args):
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin"]
    if args.device:
        cmd += ["-f", "avfoundation", "-i", ":" + args.device]
    elif args.file:
        cmd += ["-re", "-i", args.file]
    else:
        cmd += ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "10", "-i", args.url]
    return cmd + ["-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"]


def read_audio(args, segmenter):
    """Feed ffmpeg's PCM output to the segmenter; returns when the input ends."""
    proc = subprocess.Popen(ffmpeg_cmd(args), stdout=subprocess.PIPE)
    try:
        while True:
            chunk = proc.stdout.read(FRAME * 2)
            if len(chunk) < FRAME * 2:
                break
            segmenter.feed(np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0)
    finally:
        segmenter.flush()
        proc.kill()
        proc.wait()
    return proc.returncode


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--device", help="macOS audio input name or index, e.g. \"BlackHole 2ch\"")
    src.add_argument("--url", help="audio stream URL")
    src.add_argument("--file", help="audio file, replayed in real time")
    src.add_argument("--list-devices", action="store_true", help="list audio input devices and exit")
    ap.add_argument("--prompt-airport", metavar="ICAO",
                    help="bias recognition toward this airport's runway/taxiway names (off by default; "
                         "in testing it didn't improve accuracy and made transcription slower)")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="faster-whisper model name or path")
    ap.add_argument("--cpu", action="store_true", help="don't use the Apple GPU (Metal) backend")
    ap.add_argument("--threshold", type=float, help="fixed voice threshold in dBFS (default: adaptive)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--exit-when-done", action="store_true", help="exit after a --file finishes (for testing)")
    args = ap.parse_args()

    if args.list_devices:
        print("Audio input devices:")
        for i, name in enumerate(input_devices()):
            print(f"  [{i}] {name}")
        return
    if not (args.device or args.url or args.file):
        ap.error("one of --device, --url or --file is required")
    if args.device:
        names = input_devices()
        if args.device not in names and not (args.device.isdigit() and int(args.device) < len(names)):
            hint = ""
            if "speaker" in args.device.lower() or "output" in args.device.lower():
                hint = ("\nSpeakers and other outputs can't be recorded. To capture what your Mac plays, install "
                        "BlackHole (brew install blackhole-2ch), add it to a Multi-Output Device in Audio MIDI "
                        "Setup, and use --device \"BlackHole 2ch\".")
            sys.exit(f"No audio input named \"{args.device}\". Inputs on this Mac:\n  " + "\n  ".join(names) + hint)

    from faster_whisper import WhisperModel

    hub = Hub()
    status = {"model": args.model, "input": args.device or args.url or args.file}
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(hub, status))
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log(f"serving transcripts at http://127.0.0.1:{args.port}/events")

    log(f"loading {args.model} (first run downloads ~3 GB)")
    model = None
    if not args.cpu and sys.platform == "darwin":
        try:
            # About 3x faster than CPU on Apple Silicon in testing, same transcripts.
            model = WhisperModel(args.model, device="mps", compute_type="float16")
            status["device"] = "mps"
        except Exception as err:
            log(f"Apple GPU backend unavailable ({err}), using CPU")
    if model is None:
        model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=max(4, (os.cpu_count() or 8) - 2))
        status["device"] = "cpu"
    prompt = airport_prompt(args.prompt_airport.upper()) if args.prompt_airport else None
    log(f"model ready on {status['device']}")

    segments = queue.Queue()
    last_quiet_warning = [0.0]

    def transcribe_loop():
        while True:
            item = segments.get()
            if item is None:
                break
            audio, t0 = item
            started = time.time()
            # Clean captures peak around -4 dBFS; at -20 and below, callsigns get misheard
            # (in testing, "American" through a laptop mic came out as "Air Berlin").
            peak = 20 * math.log10(float(np.max(np.abs(audio))) + 1e-9)
            if peak < -20 and time.time() - last_quiet_warning[0] > 60:
                last_quiet_warning[0] = time.time()
                log(f"audio is quiet (peak {peak:.0f} dBFS); transcripts will be unreliable. Turn the volume up, "
                    "or capture the audio directly with BlackHole (see README).")
            parts, _ = model.transcribe(
                audio, language="en", beam_size=5, initial_prompt=prompt, temperature=[0.0, 0.4],
                condition_on_previous_text=False, without_timestamps=True, vad_filter=False)
            parts = [p for p in parts if not (p.no_speech_prob > 0.6 and p.avg_logprob < -0.8)]
            text = " ".join(p.text.strip() for p in parts).strip()
            if text.lower().strip(" .,!?") in HALLUCINATIONS:
                continue
            msg = {"text": text, "time": t0, "duration": round(len(audio) / SAMPLE_RATE, 2),
                   "latency": round(time.time() - started, 2), "peak_db": round(peak)}
            log(f"[{msg['duration']:.1f}s audio, peak {peak:.0f} dBFS, {msg['latency']:.1f}s] {text}")
            hub.publish(msg)

    worker = threading.Thread(target=transcribe_loop, daemon=True)
    worker.start()
    seg = Segmenter(lambda audio, t0: segments.put((audio, t0)), threshold_db=args.threshold)

    try:
        while True:
            log(f"listening to {status['input']}")
            code = read_audio(args, seg)
            if args.file:
                log("file finished")
                if args.exit_when_done:
                    segments.put(None)
                    worker.join()
                    time.sleep(1)
                    return
                while True:
                    time.sleep(3600)
            log(f"audio input ended (ffmpeg exit {code}), restarting in 5s")
            time.sleep(5)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
