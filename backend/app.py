from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import threading
import os

import sqlite3
import json
import time
from datetime import datetime, timedelta

# #region agent log
def _dlog(loc, msg, data, hid):
    try:
        with open(r'c:\Games\MC project\.cursor\debug.log', 'a', encoding='utf-8') as f:
            f.write(json.dumps({"location": loc, "message": msg, "data": data, "hypothesisId": hid, "timestamp": int(time.time() * 1000)}) + "\n")
    except Exception:
        pass
# #endregion

app = Flask(__name__, template_folder='../frontend', static_folder='../frontend/static')
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

# Database path: always next to this script (works regardless of cwd)
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sensor_data.db')

# Database Setup
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS readings
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, 
                  moisture INTEGER, 
                  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    conn.commit()
    conn.close()

init_db()

# Global State
system_state = {
    'moisture': 0,      # percentage
    'motor_status': False, # True = ON, False = OFF
    'mode': 'auto',     # 'auto' or 'manual'
    'threshold': 30     # default dry threshold percentage
}

# --- Routes ---
@app.route('/')
def index():
    return render_template('index.html')

# --- API for ESP32 ---
@app.route('/api/data', methods=['POST'])
def receive_data():
    """Endpoint for ESP32 to send moisture data."""
    global system_state
    data = request.get_json(silent=True) or {}
    # #region agent log
    _dlog("app.py:receive_data", "POST /api/data", {"raw_data": data, "mode": system_state.get("mode"), "threshold": system_state.get("threshold")}, "A")
    # #endregion

    if data and 'moisture' in data:
        try:
            system_state['moisture'] = max(0, min(100, int(data['moisture'])))
        except (TypeError, ValueError):
            system_state['moisture'] = 0

        # Auto Mode Logic
        if system_state['mode'] == 'auto':
            # #region agent log
            _dlog("app.py:receive_data", "before comparison", {"moisture": system_state["moisture"], "moisture_type": type(system_state["moisture"]).__name__, "threshold": system_state["threshold"]}, "A")
            # #endregion
            if system_state['moisture'] < system_state['threshold']:
                system_state['motor_status'] = True
            else:
                system_state['motor_status'] = False
        # #region agent log
        _dlog("app.py:receive_data", "after motor logic", {"motor_status": system_state["motor_status"]}, "A")
        # #endregion
        
        # Save to DB
        try:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("INSERT INTO readings (moisture) VALUES (?)", (system_state['moisture'],))
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"DB Error: {e}")

        # Broadcast update to Frontend
        socketio.emit('state_update', system_state)
        
        # Return motor command to ESP32
        return jsonify({
            "motor_command": system_state['motor_status']
        })
    
    return jsonify({"status": "error", "message": "No moisture data provided"}), 400

# --- History API ---
@app.route('/api/history', methods=['GET'])
def get_history():
    period = request.args.get('period', 'week')
    conn = sqlite3.connect(DB_PATH)
    try:
        c = conn.cursor()
        if period == 'day':
            cutoff = datetime.now() - timedelta(days=1)
        elif period == 'week':
            cutoff = datetime.now() - timedelta(weeks=1)
        elif period == 'month':
            cutoff = datetime.now() - timedelta(days=30)
        else:
            cutoff = datetime.now() - timedelta(weeks=1)

        c.execute("SELECT moisture, timestamp FROM readings WHERE timestamp > ? ORDER BY timestamp ASC", (cutoff,))
        rows = c.fetchall()
        data = [{"moisture": r[0], "timestamp": r[1]} for r in rows]
        return jsonify(data)
    finally:
        conn.close()

# --- WebSockets for Frontend ---
@socketio.on('connect')
def handle_connect():
    print('Client connected')
    emit('state_update', system_state)

@socketio.on('set_mode')
def handle_mode_change(data):
    """Handle mode toggle (Auto/Manual)."""
    global system_state
    if 'mode' in data:
        system_state['mode'] = data['mode']
        # If switching to auto, re-evaluate motor status based on threshold
        if system_state['mode'] == 'auto':
            if system_state['moisture'] < system_state['threshold']:
                system_state['motor_status'] = True
            else:
                system_state['motor_status'] = False

        emit('state_update', system_state, broadcast=True)

@socketio.on('manual_control')
def handle_manual_control(data):
    """Handle manual motor control."""
    global system_state
    # #region agent log
    _dlog("app.py:manual_control", "manual_control received", {"data": data, "current_mode": system_state.get("mode"), "will_apply": system_state.get("mode") == "manual" and "motor_status" in data}, "B")
    # #endregion
    if system_state['mode'] == 'manual' and 'motor_status' in data:
        system_state['motor_status'] = data['motor_status'] in (True, 'true', 1)
        emit('state_update', system_state, broadcast=True)

@socketio.on('set_threshold')
def handle_threshold_change(data):
    """Handle threshold slider change."""
    global system_state
    # #region agent log
    _dlog("app.py:set_threshold", "set_threshold received", {"data": data, "threshold_type": type(data.get("threshold")).__name__ if "threshold" in data else None}, "D")
    # #endregion
    if 'threshold' in data:
        try:
            system_state['threshold'] = max(0, min(100, int(data['threshold'])))
        except (TypeError, ValueError):
            pass

        # Re-evaluate if in auto mode
        if system_state['mode'] == 'auto':
            if system_state['moisture'] < system_state['threshold']:
                system_state['motor_status'] = True
            else:
                system_state['motor_status'] = False

        emit('state_update', system_state, broadcast=True)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
