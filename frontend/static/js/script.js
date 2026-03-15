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

// Gauge Setup (guard against missing DOM element)
let radius = 80, circumference = 80 * 2 * Math.PI;
if (progressRing && progressRing.r && progressRing.r.baseVal) {
    radius = progressRing.r.baseVal.value;
    circumference = radius * 2 * Math.PI;
    progressRing.style.strokeDasharray = `${circumference} ${circumference}`;
    progressRing.style.strokeDashoffset = circumference;
}

function setProgress(percent) {
    const pct = Math.min(100, Math.max(0, Number(percent) || 0));
    if (progressRing) {
        const offset = circumference - (pct / 100) * circumference;
        progressRing.style.strokeDashoffset = offset;
        if (pct < 30) {
            progressRing.style.stroke = '#ef4444'; // Red (Too Dry)
        } else if (pct > 70) {
            progressRing.style.stroke = '#10b981'; // Green (Good)
        } else {
            progressRing.style.stroke = '#16a34a'; // Green (Normal)
        }
    }
}

function logMsg(msg) {
    if (consoleMsg) consoleMsg.innerText = msg;
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
    if (!data) return;
    const moisture = Math.min(100, Math.max(0, Number(data.moisture) || 0));
    if (moistureValue) moistureValue.innerText = moisture;
    setProgress(moisture);

    if (motorIndicator) {
        if (data.motor_status) {
            motorIndicator.innerText = "Active";
            motorIndicator.classList.remove('off');
            motorIndicator.classList.add('on');
        } else {
            motorIndicator.innerText = "Standby";
            motorIndicator.classList.remove('on');
            motorIndicator.classList.add('off');
        }
    }

    const isAuto = data.mode === 'auto';
    if (modeToggle) modeToggle.checked = isAuto;

    if (manualGroup && thresholdGroup) {
        if (isAuto) {
            manualGroup.style.display = 'none';
            thresholdGroup.style.display = 'block';
        } else {
            manualGroup.style.display = 'block';
            thresholdGroup.style.display = 'none';
        }
    }

    const threshold = Math.min(100, Math.max(0, Number(data.threshold) || 30));
    if (thresholdSlider) thresholdSlider.value = threshold;
    if (thresholdValDisplay) thresholdValDisplay.innerText = `${threshold}%`;
});

// --- UI Interactions ---

modeToggle?.addEventListener('change', () => {
    const newMode = modeToggle.checked ? 'auto' : 'manual';
    logMsg(`Mode switched to ${newMode}`);
    socket.emit('set_mode', { mode: newMode });
});

thresholdSlider?.addEventListener('input', (e) => {
    if (thresholdValDisplay) thresholdValDisplay.innerText = `${e.target.value}%`;
});

thresholdSlider?.addEventListener('change', (e) => {
    logMsg(`Threshold set to ${e.target.value}%`);
    socket.emit('set_threshold', { threshold: e.target.value });
});

manualPumpBtn?.addEventListener('click', () => {
    if (!motorIndicator || (modeToggle && modeToggle.checked)) return; // only in manual mode
    const currentlyOn = motorIndicator.classList.contains('on');
    const newStatus = !currentlyOn;
    logMsg(newStatus ? "Pump activated manually" : "Pump deactivated");
    socket.emit('manual_control', { motor_status: newStatus });
});

// --- Chart Logic ---
let historyChart;

async function updateChart(period) {
    // Update active button state
    document.querySelectorAll('.minimal-btn.sm').forEach(btn => {
        if (btn.innerText.toLowerCase().includes(period)) {
            btn.classList.add('active');
            btn.style.backgroundColor = '#16a34a'; // Active Green
            btn.style.color = 'white';
        } else {
            btn.classList.remove('active');
            btn.style.backgroundColor = '#f1f5f9'; // Inactive Gray
            btn.style.color = '#64748b';
        }
    });

    try {
        const response = await fetch(`/api/history?period=${period}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const rawData = await response.json();

        // Prepare chart data
        const labels = rawData.map(d => {
            const date = new Date(d.timestamp);
            return period === 'day'
                ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        });
        const values = rawData.map(d => d.moisture);

        // Destroy old chart if exists
        if (historyChart) {
            historyChart.destroy();
        }

        const chartEl = document.getElementById('historyChart');
        if (!chartEl) return;
        const ctx = chartEl.getContext('2d');
        historyChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Moisture (%)',
                    data: values,
                    borderColor: '#16a34a', // Primary Green
                    backgroundColor: (context) => {
                        const ctx = context.chart.ctx;
                        const gradient = ctx.createLinearGradient(0, 0, 0, 300);
                        gradient.addColorStop(0, 'rgba(22, 163, 74, 0.4)');
                        gradient.addColorStop(1, 'rgba(22, 163, 74, 0.0)');
                        return gradient;
                    },
                    borderWidth: 3,
                    tension: 0.4, // Smooth curves
                    fill: true,
                    pointRadius: 0,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        titleColor: '#1e293b',
                        bodyColor: '#1e293b',
                        borderColor: '#e2e8f0',
                        borderWidth: 1,
                        padding: 10,
                        displayColors: false,
                        callbacks: {
                            label: (context) => `${context.parsed.y}% Moisture`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        grid: {
                            color: '#f1f5f9',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#94a3b8',
                            font: { family: 'Inter', size: 10 }
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: '#94a3b8',
                            font: { family: 'Inter', size: 10 },
                            maxTicksLimit: 8
                        }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        });
    } catch (error) {
        console.error("Failed to fetch history:", error);
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    updateChart('day');
});
