// WebSocket Connection
const socket = io();

// DOM Elements
const moistureValue = document.getElementById('moisture-value');
const progressRing = document.querySelector('.progress-ring__circle');
const motorIndicator = document.getElementById('motor-indicator');
const modeToggle = document.getElementById('mode-toggle');
const thresholdSlider = document.getElementById('threshold-slider');
const thresholdValDisplay = document.getElementById('threshold-val');
const manualGroup = document.getElementById('manual-group');
const thresholdGroup = document.getElementById('threshold-group');
const manualPumpBtn = document.getElementById('manual-pump-btn');
const consoleMsg = document.getElementById('console-msg');

// Gauge Setup
const radius = progressRing.r.baseVal.value;
const circumference = radius * 2 * Math.PI;
progressRing.style.strokeDasharray = `${circumference} ${circumference}`;
progressRing.style.strokeDashoffset = circumference;

function setProgress(percent) {
    const offset = circumference - (percent / 100) * circumference;
    progressRing.style.strokeDashoffset = offset;

    // Color change based on dryness
    if (percent < 30) {
        progressRing.style.stroke = '#ef4444'; // Red (Too Dry)
    } else if (percent > 70) {
        progressRing.style.stroke = '#10b981'; // Green (Good)
    } else {
        progressRing.style.stroke = '#3b82f6'; // Blue (Normal)
    }
}

function logMsg(msg) {
    // Simple status update for minimal theme
    consoleMsg.innerText = msg;
}

// --- Socket Events ---

socket.on('connect', () => {
    logMsg("System Online");
    const indicator = document.querySelector('.status-indicator');
    if (indicator) {
        indicator.classList.add('online');
    }
});

socket.on('disconnect', () => {
    logMsg("Connection Lost");
    const indicator = document.querySelector('.status-indicator');
    if (indicator) {
        indicator.classList.remove('online');
    }
});

socket.on('state_update', (data) => {
    // Update Moisture
    moistureValue.innerText = data.moisture;
    setProgress(data.moisture);

    // Update Motor Status
    if (data.motor_status) {
        motorIndicator.innerText = "Active";
        motorIndicator.classList.remove('off');
        motorIndicator.classList.add('on');
    } else {
        motorIndicator.innerText = "Standby";
        motorIndicator.classList.remove('on');
        motorIndicator.classList.add('off');
    }

    // Update Mode UI
    const isAuto = data.mode === 'auto';
    modeToggle.checked = isAuto;

    if (isAuto) {
        manualGroup.style.display = 'none';
        thresholdGroup.style.display = 'block';
    } else {
        manualGroup.style.display = 'block';
        thresholdGroup.style.display = 'none';
    }

    // Update Threshold Display
    thresholdSlider.value = data.threshold;
    thresholdValDisplay.innerText = `${data.threshold}%`;
});

// --- UI Interactions ---

modeToggle.addEventListener('change', () => {
    const newMode = modeToggle.checked ? 'auto' : 'manual';
    logMsg(`Mode switched to ${newMode}`);
    socket.emit('set_mode', { mode: newMode });
});

thresholdSlider.addEventListener('input', (e) => {
    thresholdValDisplay.innerText = `${e.target.value}%`;
});

thresholdSlider.addEventListener('change', (e) => {
    logMsg(`Threshold set to ${e.target.value}%`);
    socket.emit('set_threshold', { threshold: e.target.value });
});

manualPumpBtn.addEventListener('mousedown', () => {
    logMsg("Pump Activated manually");
    socket.emit('manual_control', { motor_status: true });
});

manualPumpBtn.addEventListener('mouseup', () => {
    logMsg("Pump Deactivated");
    socket.emit('manual_control', { motor_status: false });
});

manualPumpBtn.addEventListener('mouseleave', () => {
    if (motorIndicator.classList.contains('on') && !modeToggle.checked) {
        socket.emit('manual_control', { motor_status: false });
    }
});
