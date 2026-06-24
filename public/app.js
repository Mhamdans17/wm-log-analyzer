// ponytail: auto-reconnect with vanilla socket.io, no retry lib needed
const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
});

socket.on('connect', () => console.log('Socket connected'));
socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', reason);
    appendSystemMessage(`Disconnected: ${reason}. Reconnecting...`);
});
socket.on('error', (msg) => {
    console.error('Server error:', msg);
    appendSystemMessage(`! ${msg}`);
});

const logContainer = document.getElementById('logContainer');
const errorCountEl = document.getElementById('errorCount');
const warningCountEl = document.getElementById('warningCount');
const infoCountEl = document.getElementById('infoCount');
const searchInput = document.getElementById('searchInput');
const filterBtns = document.querySelectorAll('.filter-btn');
const pauseBtn = document.getElementById('pauseBtn');
const clearBtn = document.getElementById('clearBtn');

// state
let isPaused = false;
let currentFilter = 'ALL';
let searchQuery = '';
let counts = { E: 0, W: 0, I: 0 };
let allLogs = [];
const MAX_LOG_BUFFER = 5000;
const wMLogRegex = /^\[(.*?(E|W|I|D|C))\]\s(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}\.\d{3})\s(.*)$/;

// Sound state
let isSoundOn = false;
let audioCtx;
const soundBtn = document.getElementById('soundBtn');

function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playTone(freq, type, duration, vol) {
    if (!isSoundOn || !audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function playSuccessSound() {
    if (!isSoundOn || !audioCtx) return;
    // 8-bit Coin / Power-up sound
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    
    osc.frequency.setValueAtTime(440, audioCtx.currentTime);
    osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.08); // Quick octave jump
    
    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.05, audioCtx.currentTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
}

function playFailedSound() {
    if (!isSoundOn || !audioCtx) return;
    // 8-bit Damage / Error sound
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    
    osc.frequency.setValueAtTime(150, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.3); // Pitch drop
    
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
}

if (soundBtn) {
    soundBtn.addEventListener('click', () => {
        isSoundOn = !isSoundOn;
        if (isSoundOn) {
            initAudio();
            soundBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg> Sound: On`;
            playSuccessSound(); // Give feedback that sound is enabled
        } else {
            soundBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg> Sound: Off`;
        }
    });
}

socket.on('init', (data) => appendSystemMessage(data.message || 'Connected. Waiting for logs...'));

socket.on('newLog', (data) => {
    const parsed = parseLogLine(data);
    
    if (parsed.isSuccess) playSuccessSound();
    if (parsed.isFailed) playFailedSound();
    
    allLogs.push(parsed);
    if (allLogs.length > MAX_LOG_BUFFER) {
        const excess = allLogs.length - MAX_LOG_BUFFER;
        allLogs.splice(0, excess);
        counts = allLogs.reduce((acc, l) => { l.severity && (acc[l.severity] = (acc[l.severity]||0)+1); return acc; }, {E:0,W:0,I:0});
        updateCountsUI();
    } else if (parsed.severity && counts[parsed.severity] !== undefined) {
        counts[parsed.severity]++;
        updateCountsUI();
    }
    if (!isPaused) renderLog(parsed);
});

function parseLogLine(line) {
    const wmFormatMatch = line.match(/^(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2})\s(?:ICT\s)?\[(.*?(E|W|I|D|C))\]\s(.*)$/);
    const standardMatch = line.match(/^\[(.*?(E|W|I|D|C))\]\s(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}\.\d{3})\s(.*)$/);

    let date, facility, severity, message;

    if (wmFormatMatch) {
        date = wmFormatMatch[1];
        facility = `[${wmFormatMatch[2]}]`;
        severity = wmFormatMatch[3];
        message = wmFormatMatch[4];
    } else if (standardMatch) {
        facility = `[${standardMatch[1]}]`;
        severity = standardMatch[2];
        date = standardMatch[3];
        message = standardMatch[4];
    }

    let isSuccess = false;
    let isFailed = false;
    const upperRaw = line.toUpperCase();
    if (upperRaw.includes('FAILED') || upperRaw.includes('FAIL')) {
        isFailed = true;
    } else if (upperRaw.includes('SUCCESS')) {
        isSuccess = true;
    }

    if (date && message) {
        if (message.includes('"logLevel":"ERROR"')) severity = 'E';
        else if (message.includes('"logLevel":"WARN"')) severity = 'W';
        else if (message.includes('"logLevel":"INFO"')) severity = 'I';

        return { raw: line, facility, severity, date, message: formatLogMessage(message), isSuccess, isFailed };
    }
    return { raw: line, severity: 'U', message: escapeHtml(line), isSuccess, isFailed };
}

function formatLogMessage(msg) {
    try {
        const jsonStart = msg.indexOf('{\n');
        if (jsonStart !== -1) {
            const jsonStr = msg.substring(jsonStart);
            const parsed = JSON.parse(jsonStr);
            const formatted = JSON.stringify(parsed, null, 2);
            return `<span class="json-wrapper"><span class="json-toggle">[expand]</span><div class="json-content">${escapeHtml(formatted)}</div></span>`;
        }
        return msg;
    } catch {
        return msg;
    }
}

function renderLog(parsed) {
    if (currentFilter !== 'ALL' && parsed.severity !== currentFilter && parsed.severity !== 'U') return;
    if (searchQuery && !parsed.raw.toLowerCase().includes(searchQuery.toLowerCase())) return;

    const logDiv = document.createElement('div');
    logDiv.className = `log-line sev-${parsed.severity}`;

    let msgHtml = escapeHtml(parsed.message);
    let facHtml = parsed.facility ? escapeHtml(parsed.facility) : '';

    if (searchQuery) {
        msgHtml = highlightText(msgHtml, searchQuery);
        facHtml = highlightText(facHtml, searchQuery);
    }

    const copyIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
    const checkIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

    logDiv.innerHTML = parsed.date
        ? `<button class="copy-btn" title="Copy">${copyIcon}</button><span class="log-date">${parsed.date}</span><span class="log-facility">${facHtml}</span><span class="log-msg">${msgHtml}</span>`
        : `<button class="copy-btn" title="Copy">${copyIcon}</button><span class="log-msg">${msgHtml}</span>`;

    logContainer.appendChild(logDiv);

    const copyBtn = logDiv.querySelector('.copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(parsed.raw)
                .then(() => { 
                    copyBtn.innerHTML = checkIcon; 
                    showToast();
                    setTimeout(() => copyBtn.innerHTML = copyIcon, 1500); 
                })
                .catch(() => {});
        });
    }

    setTimeout(() => {
        logContainer.scrollTop = logContainer.scrollHeight;
    }, 10);
}

function updateCountsUI() {
    errorCountEl.textContent = counts.E;
    warningCountEl.textContent = counts.W;
    infoCountEl.textContent = counts.I;
}

function reRenderAll() {
    logContainer.innerHTML = '';
    allLogs.forEach(renderLog);
    logContainer.scrollTop = logContainer.scrollHeight;
}

pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
    if (!isPaused) reRenderAll();
});

clearBtn.addEventListener('click', () => {
    logContainer.innerHTML = '';
    allLogs = [];
    counts = { E: 0, W: 0, I: 0 };
    updateCountsUI();
    appendSystemMessage('Cleared.');
});

searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    reRenderAll();
});

filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        reRenderAll();
    });
});

function appendSystemMessage(msg) {
    const div = document.createElement('div');
    div.className = 'log-line';
    div.style.color = 'var(--accent-dark)';
    div.style.fontWeight = '600';
    div.textContent = `> ${msg}`;
    logContainer.appendChild(div);
    setTimeout(() => {
        logContainer.scrollTop = logContainer.scrollHeight;
    }, 10);
}

function escapeHtml(unsafe) {
    return unsafe.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

function highlightText(text, query) {
    if (!query) return text;
    const regex = new RegExp(`(${query.replace(/[-[\]{}()*+?.,\\^$|#\s]/g,'\\$&')})`, 'gi');
    return text.replace(regex, '<span class="highlight">$1</span>');
}

const pixelEmotes = [
    '/emot/cry.png',
    '/emot/goofy.png',
    '/emot/heart-eyes.png',
    '/emot/love.png',
    '/emot/numb.png',
    '/emot/sunglasses.png'
];

function showToast() {
    const emotSrc = pixelEmotes[Math.floor(Math.random() * pixelEmotes.length)];
    const toast = document.createElement('div');
    toast.className = 'pixel-toast';
    toast.innerHTML = `<span>Copied!</span> <img src="${emotSrc}" class="toast-emot">`;
    document.body.appendChild(toast);
    
    // Force reflow
    toast.offsetHeight;
    
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}