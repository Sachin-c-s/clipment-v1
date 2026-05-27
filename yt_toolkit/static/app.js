// ── Groq API key bar ──
let _groqKey = '';

function toggleKeyBar() {
  const bar = document.getElementById('keyBar');
  const btn = document.getElementById('keyToggleBtn');
  const isOpen = bar.classList.toggle('open');
  btn.classList.toggle('active', isOpen);
  if (isOpen) document.getElementById('groqKeyInput').focus();
}

function toggleKeyVisibility() {
  const input = document.getElementById('groqKeyInput');
  const icon  = document.getElementById('keyEyeIcon');
  const show  = input.type === 'password';
  input.type  = show ? 'text' : 'password';
  icon.className = show ? 'ti ti-eye-off' : 'ti ti-eye';
}

function saveKey() {
  _groqKey = document.getElementById('groqKeyInput').value.trim();
  const msg = document.getElementById('keySavedMsg');
  msg.textContent = _groqKey ? '✓ Key saved' : '✓ Cleared';
  setTimeout(() => { msg.textContent = ''; }, 2500);
}

// ── Panel open/close ──
let leftOpen = true, rightOpen = true;

function closeLeft() {
  leftOpen = false;
  document.getElementById('leftPanel').classList.add('collapsed');
  document.getElementById('leftStrip').classList.remove('hidden');
  updatePlayer();
}
function openLeft() {
  leftOpen = true;
  document.getElementById('leftPanel').classList.remove('collapsed');
  document.getElementById('leftStrip').classList.add('hidden');
  updatePlayer();
}
function closeRight() {
  rightOpen = false;
  document.getElementById('rightPanel').classList.add('collapsed');
  document.getElementById('rightStrip').classList.remove('hidden');
  updatePlayer();
}
function openRight() {
  rightOpen = true;
  document.getElementById('rightPanel').classList.remove('collapsed');
  document.getElementById('rightStrip').classList.add('hidden');
  updatePlayer();
}
function updatePlayer() {
  const p = document.getElementById('playerArea');
  p.style.marginLeft  = leftOpen  ? '240px' : '32px';
  p.style.marginRight = rightOpen ? '240px' : '32px';
}

// ── Keywords & Timestamps ──
function toggleKw(el) { el.classList.toggle('on'); }
function selectTs(el) {
  document.querySelectorAll('.ts-row').forEach(r => r.classList.remove('sel'));
  el.classList.add('sel');
}

// ── Clip search ──
function filterClips(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.clip-card').forEach(card => {
    const name = card.querySelector('.clip-name').textContent.toLowerCase();
    card.style.display = name.includes(q) ? '' : 'none';
  });
}

// ── Clip selection ──
let _activeClip = null;   // { filename, duration }

function selectClip(el, filename, clip) {
  document.querySelectorAll('.clip-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');

  document.getElementById('videoTitle').textContent = clip.filename;
  document.getElementById('clipDur').innerHTML =
    `<span style="color:#666;font-size:11px;">▶ ${clip.start_fmt.slice(0,5)}</span>` +
    `<span style="color:#2a2a35;margin:0 5px;">│</span>` +
    `<span style="background:#a78bfa22;border:0.5px solid #a78bfa55;color:#a78bfa;` +
    `font-size:10px;padding:2px 7px;border-radius:4px;font-weight:600;letter-spacing:0.04em;">` +
    `⚡ hook ends ${clip.end_fmt.slice(0,5)}</span>`;
  document.getElementById('scoreVal').textContent = clip.score;
  document.getElementById('clipBadge').textContent = clip.duration + 's';

  // Score dots
  const maxScore = window._maxScore || 1;
  const dots = Math.round((clip.score / maxScore) * 5);
  document.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('on', i < dots));

  // Matched keywords
  const kwContainer = document.getElementById('keywordChips');
  if (kwContainer) {
    kwContainer.innerHTML = clip.keywords.length
      ? clip.keywords.map(kw => `<span class="kw on">${kw}</span>`).join('')
      : '<span style="font-size:11px;color:#555;">No keyword matches for this clip.</span>';
  }

  // Video
  const video = document.getElementById('mainVideo');
  if (video) {
    video.src = `/clips/${filename}?t=${Date.now()}`;
    video.load();
    video.addEventListener('timeupdate', syncPlayhead, { passive: true });
  }

  // Download link
  const dl = document.getElementById('dlLink');
  if (dl) {
    dl.href = `/clips/${filename}`;
    dl.download = filename;
    dl.style.display = 'inline';
  }

  // Trim editor
  _activeClip = { filename, duration: clip.duration, score: clip.score, keywords: clip.keywords };
  openTrimEditor(clip.duration);
}

// ── Trim editor ──
function openTrimEditor(duration) {
  document.getElementById('trimPlaceholder').style.display = 'none';
  const editor = document.getElementById('trimEditor');
  editor.style.display = 'flex';

  const startEl = document.getElementById('trimStart');
  const endEl   = document.getElementById('trimEnd');
  startEl.max   = duration;
  endEl.max     = duration;
  startEl.value = 0;
  endEl.value   = duration;

  updateTrimUI();
  document.getElementById('recutMsg').style.display = 'none';
  document.getElementById('recutBtn').disabled = false;
  document.getElementById('recutBtn').innerHTML = '<i class="ti ti-cut"></i> Re-cut clip';
}

function onTrimInput() {
  updateTrimUI();
}

function updateTrimUI() {
  if (!_activeClip) return;
  const dur   = _activeClip.duration;
  const start = parseFloat(document.getElementById('trimStart').value) || 0;
  const end   = parseFloat(document.getElementById('trimEnd').value)   || dur;
  const newDur = Math.max(0, end - start).toFixed(1);

  document.getElementById('trimDurVal').textContent = newDur + 's';

  // Update timeline bar
  const pct = v => Math.max(0, Math.min(100, (v / dur) * 100));
  document.getElementById('trimRange').style.left  = pct(start) + '%';
  document.getElementById('trimRange').style.width = (pct(end) - pct(start)) + '%';
  document.getElementById('handleStart').style.left = pct(start) + '%';
  document.getElementById('handleEnd').style.left   = pct(end)   + '%';
}

function syncPlayhead() {
  if (!_activeClip) return;
  const video = document.getElementById('mainVideo');
  const pct   = Math.max(0, Math.min(100, (video.currentTime / _activeClip.duration) * 100));
  const ph    = document.getElementById('trimPlayhead');
  if (ph) ph.style.left = pct + '%';
}

function recutClip() {
  if (!_activeClip) return;
  const start = parseFloat(document.getElementById('trimStart').value) || 0;
  const end   = parseFloat(document.getElementById('trimEnd').value);

  if (isNaN(end) || end <= start) {
    showRecutMsg('❌ End must be greater than start.', true);
    return;
  }

  const btn = document.getElementById('recutBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Re-cutting…';
  document.getElementById('recutMsg').style.display = 'none';

  fetch('/trim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename:  _activeClip.filename,
      new_start: start,
      new_end:   end,
    }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        showRecutMsg('❌ ' + data.error, true);
        btn.disabled = false;
        btn.innerHTML = '<i class="ti ti-cut"></i> Re-cut clip';
        return;
      }

      // Build a synthetic clip object for the new trimmed file
      const trimmedClip = {
        filename:  data.filename,
        duration:  data.duration,
        score:     _activeClip.score,
        keywords:  _activeClip.keywords,
        start_fmt: '00:00.000',
        end_fmt:   `${Math.floor(data.duration/60).toString().padStart(2,'0')}:${(data.duration%60).toFixed(3).padStart(6,'0')}`,
      };

      // Add a new card to the clips list
      const list = document.getElementById('clipsList');
      const card = document.createElement('div');
      card.className = 'clip-card';
      card.innerHTML = `
        <div class="clip-thumb" style="background:#1e1a2e;">
          <i class="ti ti-scissors" style="color:#a78bfa;font-size:12px;"></i>
        </div>
        <div class="clip-info">
          <div class="clip-name">${data.filename}</div>
          <div class="clip-time">trim · ${data.duration}s</div>
        </div>`;
      card.onclick = () => selectClip(card, data.filename, trimmedClip);
      list.appendChild(card);

      // Update clip count
      const count = list.querySelectorAll('.clip-card').length;
      document.getElementById('clipCount').textContent = `${count} clips generated`;

      // Auto-select the new trimmed card
      selectClip(card, data.filename, trimmedClip);

      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-cut"></i> Re-cut clip';
      showRecutMsg('✅ Added — ' + data.duration + 's', false);
    })
    .catch(err => {
      showRecutMsg('❌ ' + err, true);
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-cut"></i> Re-cut clip';
    });
}

function showRecutMsg(msg, isError) {
  const el = document.getElementById('recutMsg');
  el.textContent = msg;
  el.style.display = 'block';
  el.style.color = isError ? '#f88' : '#7ec88a';
}

// ── Stage stepper ──
const STAGES = [
  { id: 'transcript', triggers: ['Fetching transcript', 'Fetched'] },
  { id: 'translate',  triggers: ['Translating transcript', 'Translation complete'] },
  { id: 'keywords',   triggers: ['Scraping trending', 'keywords ready'] },
  { id: 'ai',         triggers: ['Detecting idea boundaries', 'idea boundaries found', 'Chunk '] },
  { id: 'scoring',    triggers: ['Scoring and picking', 'clips ready'] },
  { id: 'download',   triggers: ['Downloading video', 'Downloaded in'] },
  { id: 'cutting',    triggers: ['Cutting and resizing', 'Short #', 'Done!'] },
];
let currentStageIndex = -1;

function updateStages(logLines) {
  const allText = logLines.join('\n');
  let latestActive = -1;
  STAGES.forEach((stage, i) => {
    if (stage.triggers.some(t => allText.includes(t))) latestActive = i;
  });
  if (latestActive === currentStageIndex) return;
  currentStageIndex = latestActive;
  document.querySelectorAll('.stage-step').forEach((el, i) => {
    el.classList.remove('done', 'active');
    if (i < latestActive) el.classList.add('done');
    else if (i === latestActive) el.classList.add('active');
  });
  document.querySelectorAll('.stage-connector').forEach((el, i) => {
    el.classList.toggle('done', i < latestActive);
  });
}

// ── Progress / log ──
let logVisible = false;
function toggleLog() {
  logVisible = !logVisible;
  const box = document.getElementById('logBox');
  const btn = document.getElementById('showLogBtn');
  box.style.display = logVisible ? 'block' : 'none';
  btn.innerHTML = logVisible
    ? '<i class="ti ti-terminal-2"></i> Hide details'
    : '<i class="ti ti-terminal-2"></i> Show details';
}
function setStatus(msg) {
  const el = document.getElementById('statusMsg');
  if (el) el.textContent = msg;
}
function showProgress(show) {
  const el = document.getElementById('progressArea');
  if (el) el.style.display = show ? 'flex' : 'none';
  if (show) { currentStageIndex = -1; logVisible = false; }
}
function appendLog(lines) {
  const el = document.getElementById('logBox');
  if (!el) return;
  el.textContent = lines.join('\n');
  el.scrollTop = el.scrollHeight;
  updateStages(lines);
}

// ── All-keywords show more ──
const KW_INITIAL = 10;
let kwExpanded = false;

function renderAllKeywords(keywords) {
  const container = document.getElementById('allKeywordChips');
  const btn       = document.getElementById('showMoreKwBtn');
  if (!container) return;
  if (!keywords || keywords.length === 0) {
    container.innerHTML = '<span style="font-size:11px;color:#555;">No trending keywords found.</span>';
    if (btn) btn.style.display = 'none';
    return;
  }
  const visible = kwExpanded ? keywords : keywords.slice(0, KW_INITIAL);
  container.innerHTML = visible.map(kw => `<span class="kw">${kw}</span>`).join('');
  const remaining = keywords.length - KW_INITIAL;
  if (btn) {
    if (remaining > 0) {
      btn.style.display = 'block';
      btn.textContent = kwExpanded ? 'Show less' : `Show ${remaining} more`;
    } else {
      btn.style.display = 'none';
    }
  }
}

function toggleAllKeywords() {
  kwExpanded = !kwExpanded;
  renderAllKeywords(window._allKeywords || []);
}

// ── Validation error banner ──
function showValidationError(errors) {
  let banner = document.getElementById('validationBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'validationBanner';
    banner.style.cssText = `
      position:fixed; top:56px; left:50%; transform:translateX(-50%);
      background:#2a1a1a; border:0.5px solid #a33; border-radius:10px;
      padding:12px 18px; font-size:12px; color:#f88; z-index:100;
      max-width:360px; width:90%; line-height:1.8;
    `;
    document.body.appendChild(banner);
  }
  banner.innerHTML = '<b style="color:#f55;">Please fix before processing:</b><br>' + errors.join('<br>');
  banner.style.display = 'block';
}
function hideValidationError() {
  const banner = document.getElementById('validationBanner');
  if (banner) banner.style.display = 'none';
}

// ── Populate clips after pipeline finishes ──
function populateClips(results, allKeywords) {
  window._maxScore    = Math.max(...results.map(r => r.score), 1);
  window._allKeywords = allKeywords || [];
  kwExpanded = false;
  renderAllKeywords(window._allKeywords);

  const list = document.getElementById('clipsList');
  list.innerHTML = '';
  document.getElementById('clipCount').textContent = `${results.length} clips generated`;

  results.forEach((clip, i) => {
    const card = document.createElement('div');
    card.className = 'clip-card' + (i === 0 ? ' active' : '');
    card.innerHTML = `
      <div class="clip-thumb"><i class="ti ti-player-play"></i></div>
      <div class="clip-info">
        <div class="clip-name">${clip.filename}</div>
        <div class="clip-time">${clip.start_fmt.slice(0,5)} – ${clip.end_fmt.slice(0,5)}</div>
      </div>`;
    card.onclick = () => selectClip(card, clip.filename, clip);
    list.appendChild(card);
  });

  // Show video player, hide progress
  showProgress(false);
  document.getElementById('mainVideo').style.display = 'block';

  // Open both sidebars
  openLeft();
  openRight();

  // Auto-select first clip
  if (results.length > 0) {
    selectClip(list.firstChild, results[0].filename, results[0]);
  }
}

// ── Process button ──
let pollInterval = null;

function processVideo() {
  const errors = [];

  const url = document.getElementById('urlInput').value.trim();
  if (!url) errors.push('• Paste a YouTube URL in the top bar');

  const countries = [...selected];
  if (countries.length === 0) errors.push('• Select at least one country (Config → Change)');

  const topNVal   = document.getElementById('cfgTopN').value.trim();
  const windowVal = document.getElementById('cfgWindow').value.trim();
  const gapVal    = document.getElementById('cfgGap').value.trim();

  if (!topNVal)   errors.push('• Set the number of clips in the Config panel');
  if (!windowVal) errors.push('• Set the clip length (seconds) in the Config panel');
  if (!gapVal)    errors.push('• Set the minimum gap between clips in the Config panel');

  if (!_groqKey) errors.push('• Enter your Groq API key (click the 🔑 key icon in the top bar)');

  if (errors.length > 0) {
    showValidationError(errors);
    return;
  }

  hideValidationError();

  const top_n          = parseInt(topNVal);
  const window_seconds = parseInt(windowVal);
  const min_gap        = parseInt(gapVal);

  // Show progress, hide video
  document.getElementById('mainVideo').style.display = 'none';
  showProgress(true);
  setStatus('Starting pipeline...');
  document.getElementById('logBox').textContent = '';
  document.getElementById('clipsList').innerHTML = '';

  fetch('/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, countries, window_seconds, top_n, min_gap, groq_api_key: _groqKey }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) { setStatus('❌ ' + data.error); return; }
      pollStatus(data.job_id);
    })
    .catch(err => setStatus('❌ ' + err));
}

function pollStatus(job_id) {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(() => {
    fetch(`/status/${job_id}`)
      .then(r => r.json())
      .then(data => {
        appendLog(data.log);
        const last = data.log[data.log.length - 1] || 'Running...';
        setStatus(last);

        if (data.status === 'done') {
          clearInterval(pollInterval);
          populateClips(data.results, data.all_keywords || []);
        } else if (data.status === 'error') {
          clearInterval(pollInterval);
          setStatus('❌ Pipeline failed — click "Show details" below.');
        }
      })
      .catch(() => {});
  }, 2000);
}

// ── Country picker ──
const countries = [
  { key: 'world',          flag: '🌐', label: 'World' },
  { key: 'india',          flag: '🇮🇳', label: 'India' },
  { key: 'united-states',  flag: '🇺🇸', label: 'US' },
  { key: 'united-kingdom', flag: '🇬🇧', label: 'UK' },
  { key: 'canada',         flag: '🇨🇦', label: 'Canada' },
  { key: 'australia',      flag: '🇦🇺', label: 'Australia' },
  { key: 'germany',        flag: '🇩🇪', label: 'Germany' },
  { key: 'france',         flag: '🇫🇷', label: 'France' },
  { key: 'brazil',         flag: '🇧🇷', label: 'Brazil' },
  { key: 'japan',          flag: '🇯🇵', label: 'Japan' },
  { key: 'south-korea',    flag: '🇰🇷', label: 'S. Korea' },
  { key: 'mexico',         flag: '🇲🇽', label: 'Mexico' },
  { key: 'indonesia',      flag: '🇮🇩', label: 'Indonesia' },
  { key: 'russia',         flag: '🇷🇺', label: 'Russia' },
  { key: 'spain',          flag: '🇪🇸', label: 'Spain' },
  { key: 'italy',          flag: '🇮🇹', label: 'Italy' },
  { key: 'netherlands',    flag: '🇳🇱', label: 'Netherlands' },
  { key: 'turkey',         flag: '🇹🇷', label: 'Turkey' },
  { key: 'saudi-arabia',   flag: '🇸🇦', label: 'Saudi Arabia' },
];

let selected = new Set(['world']);

const grid = document.getElementById('countryGrid');
countries.forEach(c => {
  const btn = document.createElement('button');
  btn.className = 'country-btn' + (selected.has(c.key) ? ' active' : '');
  btn.dataset.key = c.key;
  btn.innerHTML = '<span class="flag">' + c.flag + '</span><span class="clabel">' + c.label + '</span>';
  btn.onclick = () => {
    if (selected.has(c.key)) {
      if (selected.size > 1) { selected.delete(c.key); btn.classList.remove('active'); }
    } else {
      selected.add(c.key); btn.classList.add('active');
    }
    document.getElementById('selCount').textContent = selected.size;
    const flags = [...selected].map(k => countries.find(x => x.key === k).flag);
    document.getElementById('activeFlags').innerHTML = flags.map(f => '<span>' + f + '</span>').join('');
  };
  grid.appendChild(btn);
});

function closePopup() {
  document.getElementById('countryOverlay').classList.remove('open');
}
function confirmCountries() {
  const flags = [...selected].map(k => countries.find(x => x.key === k).flag);
  document.getElementById('activeFlags').innerHTML = flags.map(f => '<span>' + f + '</span>').join('');
  closePopup();
}
document.getElementById('countryOverlay').addEventListener('click', function(e) {
  if (e.target === this) closePopup();
});
