from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import threading

app = Flask(__name__, template_folder='../frontend', static_folder='../frontend/static')
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

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
        
        # Broadcast update to Frontend
        socketio.emit('state_update', system_state)
        
        # Return motor command to ESP32
        return jsonify({
            "motor_command": system_state['motor_status']
        })
    
    return jsonify({"status": "error", "message": "No moisture data provided"}), 400

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
