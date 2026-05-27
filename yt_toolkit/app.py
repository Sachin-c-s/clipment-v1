import os, uuid, threading, subprocess, time
from flask import Flask, render_template, request, jsonify, send_file
import pipeline
import imageio.plugins.ffmpeg as _ffmpeg_plugin
FFMPEG = _ffmpeg_plugin.get_exe()

app = Flask(__name__)

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
OUTPUT_DIR   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "clips")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# In-memory job store: { job_id: { status, log, results } }
jobs = {}


def run_job(job_id, video_url, countries, window_seconds, top_n, min_gap, groq_api_key=None):
    if not groq_api_key:
        groq_api_key = GROQ_API_KEY
    def log(msg):
        jobs[job_id]["log"].append(msg)
        print(msg)

    try:
        results, all_keywords = pipeline.run(
            video_url      = video_url,
            countries      = countries,
            groq_api_key   = groq_api_key,
            output_dir     = OUTPUT_DIR,
            window_seconds = window_seconds,
            top_n          = top_n,
            min_gap        = min_gap,
            log            = log,
        )
        jobs[job_id]["status"]       = "done"
        jobs[job_id]["results"]      = results
        jobs[job_id]["all_keywords"] = all_keywords
    except Exception as e:
        jobs[job_id]["status"] = "error"
        jobs[job_id]["log"].append(f"❌ Error: {e}")


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/run", methods=["POST"])
def start_run():
    data           = request.json
    video_url      = data.get("url", "").strip()
    countries      = data.get("countries", ["world"])
    window_seconds = int(data.get("window_seconds", 45))
    top_n          = int(data.get("top_n", 3))
    min_gap        = int(data.get("min_gap", 30))
    groq_api_key   = data.get("groq_api_key", "").strip() or GROQ_API_KEY

    if not groq_api_key:
        return jsonify({"error": "No Groq API key provided"}), 400

    if not video_url:
        return jsonify({"error": "No URL provided"}), 400

    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "running", "log": [], "results": []}

    thread = threading.Thread(
        target=run_job,
        args=(job_id, video_url, countries, window_seconds, top_n, min_gap, groq_api_key),
        daemon=True,
    )
    thread.start()

    return jsonify({"job_id": job_id})


@app.route("/status/<job_id>")
def status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify({
        "status":       job["status"],
        "log":          job["log"],
        "results":      job["results"],
        "all_keywords": job.get("all_keywords", []),
    })


@app.route("/clips/<filename>")
def serve_clip(filename):
    path = os.path.join(OUTPUT_DIR, filename)
    if not os.path.exists(path):
        return "File not found", 404
    return send_file(path, mimetype="video/mp4", conditional=True)


@app.route("/trim", methods=["POST"])
def trim_clip():
    data      = request.json
    filename  = data.get("filename", "").strip()
    new_start = float(data.get("new_start", 0))
    new_end   = float(data.get("new_end",   0))

    if not filename:
        return jsonify({"error": "No filename"}), 400
    if new_end <= new_start:
        return jsonify({"error": "End must be after start"}), 400

    clip_path = os.path.join(OUTPUT_DIR, filename)
    if not os.path.exists(clip_path):
        return jsonify({"error": "Clip not found"}), 404

    duration     = round(new_end - new_start, 2)
    base         = filename.replace(".mp4", "")
    new_filename = f"{base}_trim{int(time.time())}.mp4"
    new_path     = os.path.join(OUTPUT_DIR, new_filename)

    try:
        subprocess.run([
            FFMPEG, "-y",
            "-ss", str(new_start),
            "-i", clip_path,
            "-t", str(duration),
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
            "-c:a", "aac",
            new_path,
        ], check=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        return jsonify({"error": "ffmpeg failed", "detail": e.stderr.decode()}), 500

    return jsonify({"ok": True, "filename": new_filename, "duration": duration})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    import webbrowser, threading
    threading.Timer(1.2, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    app.run(host="0.0.0.0", port=port, debug=False)
