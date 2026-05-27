import re, json, time, os, subprocess, requests
from pathlib import Path
from bs4 import BeautifulSoup
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound, YouTubeRequestFailed
from deep_translator import GoogleTranslator
from groq import Groq
import imageio.plugins.ffmpeg as ffmpeg_plugin

FFMPEG = ffmpeg_plugin.get_exe()

COUNTRIES = {
    "world": "", "india": "india", "united-states": "united-states",
    "united-kingdom": "united-kingdom", "canada": "canada", "australia": "australia",
    "germany": "germany", "france": "france", "brazil": "brazil", "japan": "japan",
    "south-korea": "south-korea", "mexico": "mexico", "indonesia": "indonesia",
    "russia": "russia", "spain": "spain", "italy": "italy", "netherlands": "netherlands",
    "turkey": "turkey", "saudi-arabia": "saudi-arabia",
}

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; yt-toolkit/1.0)"}
BASE    = "https://youtube.trends24.in"


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def extract_video_id(url_or_id):
    for pattern in [
        r"(?:v=|\/)([0-9A-Za-z_-]{11})",
        r"youtu\.be\/([0-9A-Za-z_-]{11})",
        r"embed\/([0-9A-Za-z_-]{11})",
    ]:
        m = re.search(pattern, url_or_id)
        if m:
            return m.group(1)
    if re.match(r"^[0-9A-Za-z_-]{11}$", url_or_id):
        return url_or_id
    raise ValueError(f"Could not parse video ID from: {url_or_id!r}")


# ─────────────────────────────────────────────
# Part 1 — Transcript
# ─────────────────────────────────────────────

def fetch_transcript(video_url, languages=None, source_lang="auto", log=print):
    """Fetch and return transcript segments. Returns list of {start, duration, text}."""
    video_id = extract_video_id(video_url)
    api = YouTubeTranscriptApi(http_client=...)
    segments = []
    lang_used = ""

    try:
        tl = api.list(video_id)
        if languages:
            try:
                t = tl.find_transcript(languages)
            except NoTranscriptFound:
                t = tl.find_generated_transcript(languages)
        else:
            try:
                t = next(tr for tr in tl if not tr.is_generated)
            except StopIteration:
                t = next(iter(tl))

        fetched   = t.fetch()
        lang_used = t.language_code
        segments  = [{"start": s.start, "duration": s.duration, "text": s.text} for s in fetched]
        log(f"✅ Fetched {len(segments)} segments in [{lang_used}] {t.language}")

    except TranscriptsDisabled:
        raise RuntimeError("Transcripts are disabled for this video.")
    except NoTranscriptFound:
        raise RuntimeError("No transcript found for this video.")
    except YouTubeRequestFailed as e:
        raise RuntimeError(f"YouTube request failed: {e}")

    return segments, lang_used


def translate_transcript(segments, source_lang="auto", log=print):
    """Translate all segments to English in place. Returns segments."""
    translator = GoogleTranslator(source=source_lang, target="en")
    BATCH_SIZE = 50
    log(f"Translating {len(segments)} segments...")

    for i in range(0, len(segments), BATCH_SIZE):
        batch = segments[i:i + BATCH_SIZE]
        texts = [s["text"] for s in batch]
        try:
            translated = translator.translate_batch(texts)
            for s, t in zip(batch, translated):
                if t:
                    s["text"] = t
        except Exception as e:
            log(f"⚠️ Batch {i} failed: {e}")
        log(f"  {min(i + BATCH_SIZE, len(segments))}/{len(segments)} translated...")

    log("✅ Translation complete.")
    return segments


def save_transcript(segments, filepath, log=print):
    """Save translated transcript to a text file."""
    output_text = "\n".join(
        f"[{int(s['start'])//60:02d}:{int(s['start'])%60:02d}] {s['text'].strip()}"
        for s in segments
    )
    Path(filepath).write_text(output_text, encoding="utf-8")
    log(f"✅ Transcript saved to: {filepath}")


# ─────────────────────────────────────────────
# Part 2 — Trending Keywords
# ─────────────────────────────────────────────

def scrape_keywords(country_slug):
    """Scrape trending keywords for one country. Returns list of strings."""
    url  = f"{BASE}/{country_slug}/" if country_slug else f"{BASE}/"
    resp = requests.get(url, headers=HEADERS, timeout=10)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for h3 in soup.find_all("h3"):
        if "popular keywords" in h3.get_text(strip=True).lower():
            ol = h3.find_next_sibling("ol")
            if ol:
                return [li.get_text(strip=True) for li in ol.find_all("li")]
    return []


def fetch_keywords(selected_countries, log=print):
    """Scrape + translate keywords for all selected countries. Returns deduplicated list."""
    raw_keywords = []
    for country in selected_countries:
        slug = COUNTRIES.get(country)
        if slug is None:
            log(f"⚠️ '{country}' not recognised, skipping.")
            continue
        try:
            kws = scrape_keywords(slug)
            raw_keywords.extend(kws)
            log(f"✅ {country} — {len(kws)} keywords")
        except Exception as e:
            log(f"❌ {country} — {e}")
        time.sleep(0.5)

    raw_keywords = list(dict.fromkeys(raw_keywords))
    log(f"Scraped {len(raw_keywords)} unique keywords. Translating...")

    translated = []
    for kw in raw_keywords:
        try:
            t = GoogleTranslator(source="auto", target="en").translate(kw)
            translated.append(t)
        except Exception:
            translated.append(kw)

    translated = [w for w in translated if w and w.strip()]
    log(f"✅ {len(translated)} keywords ready.")
    return translated


# ─────────────────────────────────────────────
# Part 3 — Idea Boundary Detection (Groq)
# ─────────────────────────────────────────────

def find_idea_boundaries(segments, groq_api_key, chunk_size=50, log=print):
    """Use Groq to detect idea boundaries. Returns set of segment indices."""
    client = Groq(api_key=groq_api_key)

    def _call_groq(segs):
        numbered = "\n".join(f"[{i}] {s['text'].strip()}" for i, s in enumerate(segs))
        prompt = (
            "Below is a transcript split into numbered segments.\n"
            "Identify which segment indices mark the START of a new idea, topic, or thought.\n"
            "A new idea means the speaker genuinely shifts subject — not just a new sentence continuing the same thought.\n"
            f"Transcript:\n{numbered}\n\n"
            "Reply ONLY with a JSON array of integers, e.g. [0, 7, 15, 23]. No words or markdown."
        )
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}]
        )
        text = response.choices[0].message.content.strip()
        if "[" in text and "]" in text:
            text = text[text.find("["):text.rfind("]") + 1]
        return json.loads(text)

    idea_starts = set()
    for chunk_start in range(0, len(segments), chunk_size):
        chunk = segments[chunk_start:chunk_start + chunk_size]
        try:
            local_indices = _call_groq(chunk)
            for idx in local_indices:
                idea_starts.add(chunk_start + idx)
            log(f"✅ Chunk {chunk_start} → {len(local_indices)} idea starts")
        except Exception as e:
            log(f"❌ Chunk {chunk_start}: {e}")
        time.sleep(1)

    log(f"Total idea boundaries found: {len(idea_starts)}")
    return idea_starts


# ─────────────────────────────────────────────
# Part 4 — Score & Pick Best Windows
# ─────────────────────────────────────────────

def pick_best_clips(segments, keywords, idea_starts, window_seconds=45, top_n=3, min_gap=30, log=print):
    """
    Score segments by keyword hits, build windows from idea boundaries,
    return top_n non-overlapping clips.
    Each clip: {start, end, duration, score, keywords, text, start_fmt, end_fmt}
    """
    for s in segments:
        s["score"] = sum(1 for kw in keywords if kw.lower() in s["text"].lower())

    candidates = []
    for i, anchor in enumerate(segments):
        if i not in idea_starts:
            continue
        window_start = anchor["start"]
        window_segs  = []
        for s in segments[i:]:
            window_segs.append(s)
            elapsed = s["start"] + s.get("duration", 0) - window_start
            if elapsed >= window_seconds:
                break
        if not window_segs:
            continue
        window_end = window_segs[-1]["start"] + window_segs[-1].get("duration", 2)
        duration   = window_end - window_start
        if not (10 <= duration <= window_seconds + 20):
            continue
        hit_keywords = list(dict.fromkeys(
            kw for s in window_segs for kw in keywords
            if kw.lower() in s["text"].lower()
        ))
        candidates.append({
            "start":     window_start,
            "end":       window_end,
            "duration":  round(duration, 1),
            "score":     sum(s["score"] for s in window_segs),
            "keywords":  hit_keywords,
            "text":      " ".join(s["text"] for s in window_segs),
            "start_fmt": f"{int(window_start)//60:02d}:{window_start%60:06.3f}",
            "end_fmt":   f"{int(window_end)//60:02d}:{window_end%60:06.3f}",
        })

    candidates.sort(key=lambda x: x["score"], reverse=True)

    picked = []
    for c in candidates:
        if all(abs(c["start"] - p["start"]) >= min_gap for p in picked):
            picked.append(c)
        if len(picked) == top_n:
            break

    if not picked or picked[0]["score"] == 0:
        log("⚠️ No keyword matches found — try different countries or a broader video.")
    else:
        for i, p in enumerate(picked, 1):
            ms, ss = divmod(int(p["start"]), 60)
            me, se = divmod(int(p["end"]),   60)
            log(f"  #{i}  [{ms:02d}:{ss:02d} → {me:02d}:{se:02d}]  {p['duration']}s  score: {p['score']}")
            log(f"  Keywords: {', '.join(p['keywords']) or 'none'}")

    return picked


# ─────────────────────────────────────────────
# Part 5 — Download, Cut & Resize
# ─────────────────────────────────────────────

def download_video(video_url, output_dir, log=print):
    """Download best quality mp4+audio and merge. Returns path to full_video.mp4."""
    full_path = os.path.join(output_dir, "full_video.mp4")

    for f in os.listdir(output_dir):
        if "full_video" in f:
            os.remove(os.path.join(output_dir, f))
            log(f"🗑️ Removed old file: {f}")

    log("⬇️ Downloading video...")
    t0 = time.time()

    subprocess.run([
        "yt-dlp",
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]",
        "--merge-output-format", "mp4",
        "--ffmpeg-location", os.path.dirname(FFMPEG),
        "-o", full_path,
        video_url
    ], check=True, capture_output=True)

    # Manual merge fallback
    if not os.path.exists(full_path):
        log("⚠️ Auto-merge failed — merging manually...")
        video_part = next((f for f in os.listdir(output_dir) if "full_video" in f and f.endswith(".mp4")), None)
        audio_part = next((f for f in os.listdir(output_dir) if "full_video" in f and f.endswith(".m4a")), None)
        if video_part and audio_part:
            subprocess.run([
                FFMPEG, "-y",
                "-i", os.path.join(output_dir, video_part),
                "-i", os.path.join(output_dir, audio_part),
                "-c:v", "copy", "-c:a", "aac",
                full_path
            ], check=True, capture_output=True)
            os.remove(os.path.join(output_dir, video_part))
            os.remove(os.path.join(output_dir, audio_part))
        else:
            raise RuntimeError("Could not find video/audio parts to merge.")

    size = os.path.getsize(full_path) / 1024 / 1024
    log(f"✅ Downloaded in {time.time()-t0:.1f}s — {size:.1f} MB")
    return full_path


def cut_and_resize_clips(clips, full_video_path, output_dir, log=print):
    """
    Cut each clip and resize to 9:16 (1080x1920).
    Returns list of output filenames (just the names, not full paths).
    """
    output_files = []

    for i, clip in enumerate(clips, 1):
        safe_start = clip["start_fmt"].replace(":", "-")
        clip_path  = os.path.join(output_dir, f"clip_{i}_{safe_start}.mp4")
        short_name = f"short_{i}_{safe_start}.mp4"
        short_path = os.path.join(output_dir, short_name)

        # Cut
        subprocess.run([
            FFMPEG, "-y",
            "-ss", str(clip["start"]),
            "-i", full_video_path,
            "-t", str(clip["duration"]),
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
            "-c:a", "aac",
            clip_path
        ], check=True, capture_output=True)

        # Resize to 9:16
        subprocess.run([
            FFMPEG, "-y",
            "-i", clip_path,
            "-vf", "crop=ih*9/16:ih,scale=1080:1920",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
            "-c:a", "copy",
            short_path
        ], check=True, capture_output=True)

        os.remove(clip_path)  # remove the intermediate cut
        log(f"✅ Short #{i} ready: {short_name}")
        output_files.append(short_name)

    return output_files


# ─────────────────────────────────────────────
# Master runner — called by Flask
# ─────────────────────────────────────────────

def run(video_url, countries, groq_api_key, output_dir,
        source_lang="auto", window_seconds=45, top_n=3, min_gap=30,
        chunk_size=50, log=print):
    """
    Run the full pipeline end-to-end.
    `log` is a callable — Flask passes in a function that appends to a job log.
    Returns list of dicts: [{filename, start_fmt, end_fmt, duration, score, keywords}]
    """
    os.makedirs(output_dir, exist_ok=True)

    log("📄 Fetching transcript...")
    segments, lang_used = fetch_transcript(video_url, source_lang=source_lang, log=log)

    log("🌐 Translating transcript...")
    segments = translate_transcript(segments, source_lang=source_lang, log=log)

    log("🔍 Scraping trending keywords...")
    keywords = fetch_keywords(countries, log=log)

    log("🧠 Detecting idea boundaries with Groq...")
    idea_starts = find_idea_boundaries(segments, groq_api_key, chunk_size=chunk_size, log=log)

    log("✂️ Scoring and picking best clips...")
    picked = pick_best_clips(segments, keywords, idea_starts,
                             window_seconds=window_seconds, top_n=top_n, min_gap=min_gap, log=log)

    if not picked:
        log("⚠️ No clips found. Try different countries or a different video.")
        return [], keywords

    log("⬇️ Downloading video...")
    full_video = download_video(video_url, output_dir, log=log)

    log("🎬 Cutting and resizing clips...")
    filenames = cut_and_resize_clips(picked, full_video, output_dir, log=log)

    # Clean up full video to save space
    os.remove(full_video)
    log("🗑️ Cleaned up source video.")

    results = []
    for clip, filename in zip(picked, filenames):
        results.append({
            "filename":  filename,
            "start_fmt": clip["start_fmt"],
            "end_fmt":   clip["end_fmt"],
            "duration":  clip["duration"],
            "score":     clip["score"],
            "keywords":  clip["keywords"],
        })

    log(f"🎉 Done! {len(results)} clips ready.")
    return results, keywords
