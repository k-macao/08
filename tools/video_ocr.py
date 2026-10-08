#!/usr/bin/env python3
"""
视频画面文字提取（OCR）工具 / Video on-screen text extractor

流程：视频文件或链接 → ffmpeg 按固定间隔抽帧 → RapidOCR 识别中英文 →
相邻帧的重复文字合并（保留出现时间段）→ 输出 Markdown 或 JSON。

用法：
  python3 tools/video_ocr.py <视频文件或URL> [-o out.md] [--json] [--interval 2]

依赖（见 tools/requirements-video-ocr.txt）：
  rapidocr_onnxruntime, opencv-python-headless, imageio-ffmpeg（自带 ffmpeg）
  可选：yt-dlp（用于处理视频链接）
"""
import argparse
import difflib
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile


def find_ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        sys.exit("未找到 ffmpeg：请安装 ffmpeg，或 pip install imageio-ffmpeg")


def download_video(url, workdir):
    """用 yt-dlp 下载链接视频（限制 720p 以内，减少耗时）。"""
    ytdlp = shutil.which("yt-dlp")
    cmd_base = [ytdlp] if ytdlp else [sys.executable, "-m", "yt_dlp"]
    out_tpl = os.path.join(workdir, "video.%(ext)s")
    cmd = cmd_base + ["-f", "best[height<=720]/best", "-o", out_tpl, "--no-playlist", url]
    try:
        subprocess.run(cmd, check=True, stdout=sys.stderr)
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        sys.exit(f"下载视频失败（需要 yt-dlp）：{e}")
    for name in os.listdir(workdir):
        if name.startswith("video.") and not name.endswith((".part", ".ytdl")):
            return os.path.join(workdir, name)
    sys.exit("下载完成但未找到视频文件")


def extract_frames(ffmpeg, video, frames_dir, interval):
    """每 interval 秒抽一帧，文件名编码时间戳（秒）。"""
    pattern = os.path.join(frames_dir, "f_%06d.jpg")
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", video,
           "-vf", f"fps=1/{interval}", "-q:v", "3", pattern]
    subprocess.run(cmd, check=True)
    frames = sorted(f for f in os.listdir(frames_dir) if f.startswith("f_"))
    return [(i * interval, os.path.join(frames_dir, f)) for i, f in enumerate(frames)]


def ocr_frame(engine, path, min_score):
    """返回一帧中按阅读顺序排列的文字行。"""
    result, _ = engine(path)
    if not result:
        return []
    items = []
    for box, text, score in result:
        if float(score) < min_score or not text.strip():
            continue
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        items.append({"text": text.strip(), "y": sum(ys) / 4, "x": min(xs),
                      "h": max(ys) - min(ys)})
    # 按行聚类：纵坐标接近（小于行高一半）视为同一行
    items.sort(key=lambda it: it["y"])
    lines, cur = [], []
    for it in items:
        if cur and abs(it["y"] - cur[-1]["y"]) > max(it["h"], cur[-1]["h"]) * 0.5:
            lines.append(cur)
            cur = []
        cur.append(it)
    if cur:
        lines.append(cur)
    return [" ".join(x["text"] for x in sorted(line, key=lambda x: x["x"])) for line in lines]


def norm(s):
    return "".join(ch for ch in s.lower() if not ch.isspace())


def similar(a, b):
    if not a or not b:
        return False
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio() >= 0.85


def merge_segments(frame_texts, interval):
    """把相邻帧里相同/相似的文字合并成一段，记录出现的时间范围。"""
    segments = []  # {"start","end","text"}
    for t, lines in frame_texts:
        if not lines:
            continue
        text = "\n".join(lines)
        if segments and abs(segments[-1]["end"] - t) < 1e-6 and similar(segments[-1]["text"], text):
            segments[-1]["end"] = t + interval
            continue
        segments.append({"start": t, "end": t + interval, "text": text})
    return segments


def fmt_ts(sec):
    sec = int(sec)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def render_markdown(source, segments, duration_frames):
    out = [f"# 画面文字提取 / On-screen text", "", f"来源：{source}", ""]
    if not segments:
        out.append("（未识别到画面文字）")
        return "\n".join(out) + "\n"
    for seg in segments:
        out.append(f"## [{fmt_ts(seg['start'])} – {fmt_ts(seg['end'])}]")
        out.append("")
        out.append(seg["text"])
        out.append("")
    out.append(f"> 共抽取 {duration_frames} 帧，合并为 {len(segments)} 个文字段。")
    return "\n".join(out) + "\n"


def main():
    ap = argparse.ArgumentParser(description="提取视频画面中的文字（OCR）")
    ap.add_argument("source", help="视频文件路径或视频链接")
    ap.add_argument("-o", "--output", help="输出文件（默认打印到标准输出）")
    ap.add_argument("--json", action="store_true", help="输出 JSON 而不是 Markdown")
    ap.add_argument("--interval", type=float, default=2.0, help="抽帧间隔（秒），默认 2")
    ap.add_argument("--min-score", type=float, default=0.6, help="OCR 置信度下限，默认 0.6")
    args = ap.parse_args()
    if not math.isfinite(args.interval) or args.interval <= 0:
        ap.error("--interval 必须是大于 0 的有限秒数")
    if not math.isfinite(args.min_score) or not 0 <= args.min_score <= 1:
        ap.error("--min-score 必须在 0 到 1 之间")

    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError as exc:
        sys.exit(f"OCR 依赖无法加载：{exc}\n请执行 bash tools/setup_video_ocr.sh，"
                 "再用 .venv/bin/python 运行本工具（修复缺少依赖 / libGL / OpenCV 冲突）。")

    ffmpeg = find_ffmpeg()
    with tempfile.TemporaryDirectory(prefix="video_ocr_") as tmp:
        if args.source.startswith(("http://", "https://")):
            video = download_video(args.source, tmp)
        else:
            video = args.source
            if not os.path.isfile(video):
                sys.exit(f"找不到视频文件：{video}")

        frames_dir = os.path.join(tmp, "frames")
        os.makedirs(frames_dir)
        print("抽帧中…", file=sys.stderr)
        frames = extract_frames(ffmpeg, video, frames_dir, args.interval)

        engine = RapidOCR()
        frame_texts = []
        for i, (t, path) in enumerate(frames, 1):
            frame_texts.append((t, ocr_frame(engine, path, args.min_score)))
            if i % 20 == 0:
                print(f"OCR {i}/{len(frames)}", file=sys.stderr)

    segments = merge_segments(frame_texts, args.interval)
    if args.json:
        content = json.dumps({"source": args.source, "segments": segments},
                             ensure_ascii=False, indent=2) + "\n"
    else:
        content = render_markdown(args.source, segments, len(frames))

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"已写入 {args.output}", file=sys.stderr)
    else:
        sys.stdout.write(content)


if __name__ == "__main__":
    main()
