#!/usr/bin/env sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUTPUT_DIR="$PROJECT_ROOT/public/sprites"
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT INT TERM

mkdir -p "$OUTPUT_DIR"

make_frame() {
  source_file=$1
  output_file=$2
  top_dx=$3
  top_dy=$4

  convert "$source_file" \
    -alpha on \
    -virtual-pixel transparent \
    -define distort:viewport=160x160+0+0 \
    -distort Perspective \
    "0,0 $top_dx,$top_dy 159,0 $((159 + top_dx)),$top_dy 0,159 0,159 159,159 159,159" \
    +repage \
    -gravity south -background none -extent 160x160 \
    "$output_file"
}

generate_sheet() {
  input_file=$1
  stem=$(basename "$input_file")
  stem=${stem%.*}
  sheet_file="$OUTPUT_DIR/${stem}_actions.webp"
  frame_dir="$WORK_DIR/$stem"
  mkdir -p "$frame_dir"

  convert "$input_file" -trim -resize '128x140>' \
    -gravity south -background none -extent 160x160 "$frame_dir/base.png"

  cp "$frame_dir/base.png" "$frame_dir/0.png"
  make_frame "$frame_dir/base.png" "$frame_dir/1.png" -3 1
  make_frame "$frame_dir/base.png" "$frame_dir/2.png" 3 0
  cp "$frame_dir/base.png" "$frame_dir/3.png"
  make_frame "$frame_dir/base.png" "$frame_dir/4.png" -11 3
  make_frame "$frame_dir/base.png" "$frame_dir/5.png" 14 -2
  make_frame "$frame_dir/base.png" "$frame_dir/6.png" 8 2
  make_frame "$frame_dir/base.png" "$frame_dir/7.png" -2 1

  convert \
    \( "$frame_dir/0.png" "$frame_dir/1.png" "$frame_dir/2.png" "$frame_dir/3.png" +append \) \
    \( "$frame_dir/4.png" "$frame_dir/5.png" "$frame_dir/6.png" "$frame_dir/7.png" +append \) \
    -append -quality 88 -define webp:lossless=false -define webp:method=6 "$sheet_file"
}

for hero_file in "$PROJECT_ROOT"/public/heroes/*; do
  generate_sheet "$hero_file"
done

# 마마가 소환하는 임프도 필드 캐릭터이므로 같은 프레임 규칙을 적용한다.
generate_sheet "$PROJECT_ROOT/public/ui/imp.png"
