import sqlite3
from flask import Flask, request, jsonify, render_template, session, redirect, url_for
from flask_cors import CORS
import os
from datetime import datetime
import socket
import functools
import io
import pandas as pd
from authlib.integrations.flask_client import OAuth
from flask import send_file

app = Flask(__name__)

app.secret_key = "qr_attendance_secret_123"
app.config['SESSION_COOKIE_NAME'] = 'qr_attendance_session'
app.config['SESSION_COOKIE_SAMESITE'] = "Lax"
app.config['SESSION_COOKIE_SECURE'] = False

CORS(app, supports_credentials=True)
DB_FILE = "attendance.db"

from dotenv import load_dotenv

load_dotenv()

# Allow HTTP transport for OAuth testing over ngrok/duckdns
os.environ['AUTHLIB_INSECURE_TRANSPORT'] = '1'
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

# --- OAUTH SETUP ---
oauth = OAuth(app)
google = oauth.register(
    name='google',
    client_id=os.environ.get('GOOGLE_CLIENT_ID', 'YOUR_CLIENT_ID_HERE'),
    client_secret=os.environ.get('GOOGLE_CLIENT_SECRET', 'YOUR_SECRET_HERE'),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={
        'scope': 'openid email profile'
    }
)

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    # Create users
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            role TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Create students
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            roll_no TEXT UNIQUE,
            class TEXT
        )
    """)

    # Create teachers
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS teachers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL
        )
    """)

    # Create sessions
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_name TEXT,
            date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Create attendance
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            roll_no TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(id),
            FOREIGN KEY (roll_no) REFERENCES students(roll_no)
        )
    """)

    # Seed the initial teacher record securely
    cursor.execute("""
        INSERT OR IGNORE INTO teachers (name, email)
        VALUES ('Akash Suresh', 'akashsuresh2027@cs.ajce.in')
    """)

    conn.commit()
    conn.close()

# --- DECORATORS ---
def login_required(f):
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

def teacher_required(f):
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session or session.get('role') != 'teacher':
            return jsonify({"error": "Unauthorized Access"}), 403
        return f(*args, **kwargs)
    return decorated_function

def student_required(f):
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session or session.get('role') != 'student':
            return jsonify({"error": "Unauthorized Access"}), 403
        return f(*args, **kwargs)
    return decorated_function

# --- AUTH ROUTES ---
@app.route('/')
@app.route('/login')
def login():
    if 'user_id' in session:
        if session.get('role') == 'teacher':
            return redirect(url_for('teacher_dashboard'))
        return redirect(url_for('student_dashboard'))
    return render_template('index.html')

@app.route('/google_login')
def google_login():
    redirect_uri = url_for('google_callback', _external=True)
    return google.authorize_redirect(redirect_uri)

@app.route('/google_callback')
def google_callback():
    try:
        token = google.authorize_access_token()
        user_info = token.get('userinfo')
        
        email = user_info['email']
        name = user_info.get('name', 'Unknown')
        
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # Query the teachers table to dynamically determine the role
        cursor.execute("SELECT * FROM teachers WHERE email = ?", (email,))
        teacher_record = cursor.fetchone()
        
        resolved_role = 'teacher' if teacher_record else 'student'

        # Retrieve or create user in users wrapper table
        cursor.execute("SELECT id, role, name FROM users WHERE email = ?", (email,))
        user = cursor.fetchone()
        
        if not user:
            cursor.execute("INSERT INTO users (name, email, role) VALUES (?, ?, ?)", (name, email, resolved_role))
            user_id = cursor.lastrowid
            
            # Also create student record if resolved as student
            if resolved_role == 'student':
                cursor.execute("INSERT INTO students (name, email) VALUES (?, ?)", (name, email))
        else:
            user_id = user[0]
            name = user[2]
            
            # Optionally update the user's role in the DB to stay synchronized if their status changed
            if user[1] != resolved_role:
                cursor.execute("UPDATE users SET role = ? WHERE id = ?", (resolved_role, user_id))
            
        conn.commit()
        conn.close()
        
        session['user_id'] = user_id
        session['email'] = email
        session['role'] = resolved_role
        session['name'] = name
        
        if resolved_role == 'teacher':
            return redirect(url_for('teacher_dashboard'))
        else:
            return redirect(url_for('student_dashboard'))
    except Exception as e:
        import traceback
        return jsonify({"error": "Internal Server Error", "message": str(e), "traceback": traceback.format_exc()}), 500

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

# --- DASHBOARDS ---
@app.route('/teacher_dashboard')
@teacher_required
def teacher_dashboard():
    return render_template('teacher_portal.html')

@app.route('/student_dashboard')
@login_required
def student_dashboard():
    return render_template('mark.html')

# --- API ROUTES ---

@app.route('/get_student_profile', methods=['GET'])
@student_required
def get_student_profile():
    email = session.get('email')
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT name, roll_no, class FROM students WHERE email = ?", (email,))
    record = cursor.fetchone()
    conn.close()
    
    if record:
        return jsonify({"name": record[0], "roll_no": record[1], "class": record[2]}), 200
    return jsonify({"error": "Profile not found"}), 404

@app.route('/update_profile', methods=['POST'])
@student_required
def update_profile():
    data = request.json
    roll_no = data.get("roll_no")
    student_class = data.get("class")
    name = data.get("name", session.get('name'))
    email = session.get('email')

    if not roll_no or not student_class:
        return jsonify({"error": "Roll Number and Class are required"}), 400

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    try:
        cursor.execute("""
            UPDATE students SET name = ?, roll_no = ?, class = ? WHERE email = ?
        """, (name, roll_no, student_class, email))
        conn.commit()
        
        cursor.execute("UPDATE users SET name = ? WHERE email = ?", (name, email))
        conn.commit()
        
        session['name'] = name
    except Exception as e:
        conn.close()
        return jsonify({"error": str(e)}), 500
    
    conn.close()
    return jsonify({"message": "Profile updated successfully!"}), 200

@app.route('/create_session', methods=['POST'])
@teacher_required
def create_session():
    data = request.json
    session_name = data.get("session_name")
    if not session_name:
        session_name = f"Session {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("INSERT INTO sessions (session_name) VALUES (?)", (session_name,))
    session_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return jsonify({"session_id": session_id, "session_name": session_name}), 201

@app.route('/get_sessions', methods=['GET'])
@teacher_required
def get_sessions():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT id, session_name, date FROM sessions ORDER BY date DESC")
    records = cursor.fetchall()
    conn.close()
    
    return jsonify({"data": [{"id": r[0], "session_name": r[1], "date": r[2]} for r in records]}), 200

@app.route('/session_attendance/<int:session_id>', methods=['GET'])
@teacher_required
def get_session_attendance(session_id):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT s.name, s.roll_no, s.class, a.timestamp, a.id
        FROM attendance a
        JOIN students s ON a.roll_no = s.roll_no
        WHERE a.session_id = ?
        ORDER BY a.timestamp DESC
    ''', (session_id,))
    records = cursor.fetchall()
    conn.close()
    
    return jsonify({"data": [{"name": r[0], "roll_no": r[1], "class": r[2], "timestamp": r[3]} for r in records]}), 200

@app.route('/attendance', methods=['GET'])
@teacher_required
def get_all_attendance():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT s.name, s.roll_no, s.class, a.timestamp, a.id, se.session_name
        FROM attendance a
        JOIN students s ON a.roll_no = s.roll_no
        LEFT JOIN sessions se ON a.session_id = se.id
        ORDER BY a.timestamp DESC
    ''')
    records = cursor.fetchall()
    conn.close()
    
    return jsonify({"data": [{"name": r[0], "roll_no": r[1], "class": r[2], "timestamp": r[3], "session_name": r[5] or f"Session {r[4]}"} for r in records]}), 200

@app.route("/mark_attendance", methods=["POST"])
@teacher_required
def api_mark_attendance():
    data = request.json
    if not data:
        return jsonify({"error": "Invalid request"}), 400
        
    roll_no = data.get("roll_no")
    session_id = data.get("session_id")

    if not roll_no or not session_id:
        return jsonify({"error": "Roll Number and Session ID are required"}), 400

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM students WHERE roll_no = ?", (roll_no,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({"error": "Student not registered", "status": "unregistered"}), 404

    cursor.execute("SELECT * FROM attendance WHERE roll_no = ? AND session_id = ?", (roll_no, session_id))
    if cursor.fetchone():
        conn.close()
        return jsonify({"error": "Already Marked", "status": "duplicate"}), 409

    try:
        cursor.execute(
            "INSERT INTO attendance (roll_no, session_id) VALUES (?, ?)",
            (roll_no, session_id)
        )
        conn.commit()
        return jsonify({"message": "Success", "status": "success"}), 201
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/dashboard')
@teacher_required
def dashboard():
    return render_template('dashboard.html')

@app.route('/api/attendance_stats', methods=['GET'])
@teacher_required
def attendance_stats():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # Total students
    cursor.execute("SELECT COUNT(*) FROM students")
    total_students = cursor.fetchone()[0]
    
    # Get the latest session ID for "present/absent" logic
    cursor.execute("SELECT id FROM sessions ORDER BY date DESC LIMIT 1")
    session_record = cursor.fetchone()
    if session_record:
        latest_session_id = session_record[0]
        # Present in latest session
        cursor.execute("SELECT COUNT(DISTINCT roll_no) FROM attendance WHERE session_id = ?", (latest_session_id,))
        present = cursor.fetchone()[0]
    else:
        present = 0
        
    absent = total_students - present if total_students > present else 0
    
    # Total sessions
    cursor.execute("SELECT COUNT(*) FROM sessions")
    total_sessions = cursor.fetchone()[0]
    
    # Attendance per student
    cursor.execute('''
        SELECT s.name, s.roll_no, COUNT(DISTINCT a.session_id) as attended
        FROM students s
        LEFT JOIN attendance a ON s.roll_no = a.roll_no
        GROUP BY s.roll_no
    ''')
    student_records = cursor.fetchall()
    
    students_data = []
    for record in student_records:
        name = record[0]
        attended = record[2]
        percentage = round((attended / total_sessions * 100), 2) if total_sessions > 0 else 0
        students_data.append({"name": name, "attendance": percentage})
        
    conn.close()
    
    return jsonify({
        "total_students": total_students,
        "present": present,
        "absent": absent,
        "students": students_data
    }), 200

@app.route('/export_attendance', methods=['GET'])
@teacher_required
def export_attendance():
    conn = sqlite3.connect(DB_FILE)
    query = '''
        SELECT s.name AS "Student Name", s.roll_no AS "Roll Number", s.class AS "Class", 
               se.session_name AS "Session Name", a.timestamp AS "Timestamp"
        FROM attendance a
        JOIN students s ON a.roll_no = s.roll_no
        JOIN sessions se ON a.session_id = se.id
        ORDER BY a.timestamp DESC
    '''
    df = pd.read_sql_query(query, conn)
    conn.close()
    
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Attendance')
    
    output.seek(0)
    
    return send_file(
        output,
        as_attachment=True,
        download_name='attendance_report.xlsx',
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )

def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

if __name__ == '__main__':
    init_db()
    local_ip = get_ip()

    print(f"\n{'='*50}")
    print("Server is running with Google OAuth Support!")
    print(f"On this PC, go to: http://localhost:5000")
    print(f"On your PHONE, go to: http://{local_ip}:5000")
    print(f"{'='*50}\n")

    app.run(host="0.0.0.0", port=5000, debug=False)