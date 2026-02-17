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
        progressRing.style.stroke = '#16a34a'; // Green (Normal)
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

        // Create new chart
        const ctx = document.getElementById('historyChart').getContext('2d');
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
