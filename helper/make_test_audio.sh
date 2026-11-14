#!/usr/bin/env bash
# Synthesize radio-style ATC test audio with macOS `say`.
# Usage: helper/make_test_audio.sh out.wav ["transmission" ...]
set -euo pipefail

out=${1:-atc-test.wav}
shift || true
lines=("$@")
if [ ${#lines[@]} -eq 0 ]; then
	lines=(
		"American 2345, Dallas ground, runway 17 center, taxi via Kilo, Echo Juliet, hold short of runway 17 right."
		"Kilo, Echo Juliet, hold short 17 right, American 2345."
		"Envoy 3401, runway 18 left, taxi via Echo, Whiskey Kilo."
		"Southwest 12, turn right Lima 2, then Kilo, hold short of Echo Juliet."
	)
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
voices=("Samantha" "Fred")
parts=()
for i in "${!lines[@]}"; do
	say -v "${voices[$((i % 2))]}" -r 200 -o "$tmp/$i.aiff" "${lines[$i]}"
	# Radio voice band, compression, then a 2 s gap before the next transmission.
	ffmpeg -loglevel error -y -i "$tmp/$i.aiff" \
		-af "highpass=f=300,lowpass=f=3000,acompressor,volume=1.5,apad=pad_dur=2" -ar 16000 -ac 1 "$tmp/$i.wav"
	parts+=("$tmp/$i.wav")
done
printf "file '%s'\n" "${parts[@]}" > "$tmp/list.txt"
# Lead-in silence, then static under everything.
ffmpeg -loglevel error -y -f lavfi -t 1.5 -i anullsrc=r=16000:cl=mono -f concat -safe 0 -i "$tmp/list.txt" \
	-filter_complex "[0][1]concat=n=2:v=0:a=1[s];anoisesrc=r=16000:a=0.01:c=pink[n];[s][n]amix=inputs=2:duration=first:normalize=0" \
	"$out"
echo "Wrote $out"
