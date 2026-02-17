from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import threading

import sqlite3
from datetime import datetime, timedelta

app = Flask(__name__, template_folder='../frontend', static_folder='../frontend/static')
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

# Database Setup
def init_db():
    conn = sqlite3.connect('sensor_data.db')
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
    data = request.json
    
    if 'moisture' in data:
        system_state['moisture'] = data['moisture']
        
        # Audio Mode Logic
        if system_state['mode'] == 'auto':
            if system_state['moisture'] < system_state['threshold']:
                system_state['motor_status'] = True
            else:
                system_state['motor_status'] = False
        
        # Save to DB
        try:
            conn = sqlite3.connect('sensor_data.db')
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
    conn = sqlite3.connect('sensor_data.db')
    c = conn.cursor()
    
    if period == 'day':
        # Last 24 hours
        cutoff = datetime.now() - timedelta(days=1)
    elif period == 'week':
        # Last 7 days
        cutoff = datetime.now() - timedelta(weeks=1)
    elif period == 'month':
        # Last 30 days
        cutoff = datetime.now() - timedelta(days=30)
    else:
        cutoff = datetime.now() - timedelta(weeks=1)

    c.execute("SELECT moisture, timestamp FROM readings WHERE timestamp > ? ORDER BY timestamp ASC", (cutoff,))
    rows = c.fetchall()
    conn.close()
    
    data = [{"moisture": r[0], "timestamp": r[1]} for r in rows]
    return jsonify(data)

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
    if system_state['mode'] == 'manual' and 'motor_status' in data:
        system_state['motor_status'] = data['motor_status']
        emit('state_update', system_state, broadcast=True)

@socketio.on('set_threshold')
def handle_threshold_change(data):
    """Handle threshold slider change."""
    global system_state
    if 'threshold' in data:
        system_state['threshold'] = int(data['threshold'])
        
        # Re-evaluate if in auto mode
        if system_state['mode'] == 'auto':
             if system_state['moisture'] < system_state['threshold']:
                system_state['motor_status'] = True
             else:
                system_state['motor_status'] = False
                
        emit('state_update', system_state, broadcast=True)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
