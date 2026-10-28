#!/usr/bin/env bash
#
# The clip at the top of the README: the rendered clips given, stitched with
# a short dissolve, as one GIF. GitHub plays video in a README only from its
# own uploads, which CI cannot make, so what the README embeds is a GIF at
# an address `site-clips` keeps current; the MP4 and WebM beside it are for
# everything that can play them.
#
# A dozen frames a second and a palette of the whole piece keep a sixteen
# second GIF of a flat UI around three megabytes, where sixty frames a
# second would make one GitHub's image proxy will not carry.
#
# Usage: hero-gif.sh <out.gif> <clip.mp4> <clip.mp4> [clip.mp4 ...]
set -euo pipefail

out="$1"; shift
[ "$#" -ge 2 ] || { echo "hero-gif.sh needs at least two clips" >&2; exit 2; }

fps=12
width=960
dissolve=0.5

inputs=()
filter=""
prev="[0:v]"
offset=0
i=0
for clip in "$@"; do
  inputs+=(-i "$clip")
  if [ "$i" -gt 0 ]; then
    # Each dissolve starts half a second before the piece so far ends.
    offset=$(awk -v so_far="$offset" -v d="$dissolve" 'BEGIN { printf "%.3f", so_far - d }')
    filter+="${prev}[$i:v]xfade=transition=fade:duration=$dissolve:offset=$offset[x$i];"
    prev="[x$i]"
  fi
  duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$clip")
  offset=$(awk -v so_far="$offset" -v d="$duration" 'BEGIN { printf "%.3f", so_far + d }')
  i=$((i + 1))
done
# One palette for the whole piece, from the differences between frames, so a
# cursor crossing a flat panel does not cost a new palette every frame.
filter+="${prev}fps=$fps,scale=$width:-1:flags=lanczos,split[a][b];"
filter+="[a]palettegen=max_colors=256:stats_mode=diff[p];"
filter+="[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle"

ffmpeg -v error -y "${inputs[@]}" -filter_complex "$filter" -loop 0 "$out"
echo "$out: $(du -h "$out" | cut -f1), $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")s"
