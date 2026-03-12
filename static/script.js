const API_BASE_URL = window.location.origin;

function logout() {
    window.location.href = '/logout';
}

function setupLogoutBtn() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
}

// Student View Logic (mark.html)
async function initStudentView() {
    const formElement = document.getElementById('studentQrForm');
    const nameInput = document.getElementById('qrStudentName');
    const rollInput = document.getElementById('qrStudentRoll');
    const classInput = document.getElementById('qrStudentClass');
    const qrOutputContainer = document.getElementById('qrOutputContainer');
    const studentQrcode = document.getElementById('studentQrcode');
    const statusElement = document.getElementById('statusMessage');
    const btn = document.getElementById('generateQrBtn');

    if (!formElement) return;

    // Fetch profile on load
    try {
        const res = await fetch(`${API_BASE_URL}/get_student_profile`);
        if (res.ok) {
            const data = await res.json();
            if (data.name) nameInput.value = data.name;
            if (data.roll_no) rollInput.value = data.roll_no;
            if (data.class) classInput.value = data.class;

            // Auto generate QR if profile completes
            if (data.roll_no && data.class) {
                generateStudentQr(data.name, data.roll_no, data.class);
            }
        }
    } catch (e) {
        console.error("Failed to load profile", e);
    }

    formElement.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = nameInput.value.trim();
        const roll = rollInput.value.trim();
        const studentClass = classInput.value.trim();

        btn.disabled = true;
        btn.textContent = 'Updating...';
        statusElement.classList.add('hidden');

        try {
            const response = await fetch(`${API_BASE_URL}/update_profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, roll_no: roll, class: studentClass })
            });

            if (response.ok) {
                generateStudentQr(name, roll, studentClass);
                statusElement.textContent = "✅ Profile updated!";
                statusElement.classList.remove('hidden', 'status-error');
                statusElement.classList.add('status-success');
            } else {
                const err = await response.json();
                statusElement.textContent = "❌ " + (err.error || "Failed to update profile.");
                statusElement.classList.remove('hidden', 'status-success');
                statusElement.classList.add('status-error');
            }
        } catch (error) {
            console.error(error);
            statusElement.textContent = "❌ Network error.";
            statusElement.classList.remove('hidden', 'status-success');
            statusElement.classList.add('status-error');
        }

        btn.disabled = false;
        btn.textContent = 'Update Profile & QR';
    });

    function generateStudentQr(name, roll, studentClass) {
        const qrData = JSON.stringify({ roll_no: roll, name: name, class: studentClass });
        studentQrcode.innerHTML = '';
        new QRCode(studentQrcode, { text: qrData, width: 256, height: 256, colorDark: "#1e1b4b", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
        qrOutputContainer.classList.remove('hidden');
        qrOutputContainer.classList.add('bounce-in');
    }
}

// Teacher Portal (Dashboard) Logic
function initTeacherDashboard() {
    const generateBtn = document.getElementById('startSessionBtn');
    const sessionInfo = document.getElementById('sessionInfo');
    const sessionIdDisplay = document.getElementById('sessionIdDisplay');
    const scanContainer = document.getElementById('scanContainer');
    const scanStatus = document.getElementById('scanStatus');
    const tableBody = document.getElementById('attendanceTableBody');
    const refreshBtn = document.getElementById('refreshBtn');
    const exportBtn = document.getElementById('exportBtn');
    const scanCounter = document.getElementById('scanCounter');
    const stopScanBtn = document.getElementById('stopScanBtn');
    const toastContainer = document.getElementById('toastContainer');

    const resumeScanBtn = document.getElementById('resumeScanBtn');
    const endSessionBtn = document.getElementById('endSessionBtn');
    const sessionControls = document.getElementById('sessionControls');

    let currentSessionId = null;
    let scanCount = 0;

    // Multi-QR scanner variables
    let video = document.getElementById("videoFeed");
    let canvasElement = document.getElementById("canvasOutput");
    let canvas = canvasElement ? canvasElement.getContext("2d", { willReadFrequently: true }) : null;
    let cameraLoading = document.getElementById("cameraLoading");
    let requestAnimationFrameId = null;
    let isScanning = false;
    let scannedCache = {}; // {roll_no: timestamp}
    let lastScanTime = 0;
    let lastCode = null;

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            window.location.href = `${API_BASE_URL}/export_attendance`;
        });
    }

    if (generateBtn) {
        generateBtn.addEventListener('click', async () => {
            try {
                generateBtn.disabled = true;
                generateBtn.textContent = 'Starting...';

                const response = await fetch(`${API_BASE_URL}/create_session`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });

                if (!response.ok) {
                    throw new Error("Unauthorized or server error");
                }

                const data = await response.json();
                currentSessionId = data.session_id;

                sessionIdDisplay.textContent = `Session #${currentSessionId}: ${data.session_name}`;
                sessionInfo.classList.remove('hidden');

                generateBtn.classList.add('hidden');
                if (scanContainer) scanContainer.classList.remove('hidden');
                if (sessionControls) sessionControls.classList.remove('hidden');
                if (resumeScanBtn) resumeScanBtn.classList.add('hidden');

                startScanner();
                loadDashboard(tableBody, currentSessionId);
            } catch (e) {
                console.error("Error creating session", e);
                alert("Failed to create session on the server.");
                generateBtn.disabled = false;
                generateBtn.textContent = 'Start New Session';
            }
        });
    }

    if (stopScanBtn) {
        stopScanBtn.addEventListener('click', () => {
            stopScanner();
            if (scanContainer) scanContainer.classList.add('hidden');
            if (currentSessionId && resumeScanBtn) resumeScanBtn.classList.remove('hidden');
        });
    }

    if (resumeScanBtn) {
        resumeScanBtn.addEventListener('click', () => {
            if (currentSessionId) {
                if (scanContainer) scanContainer.classList.remove('hidden');
                startScanner();
                resumeScanBtn.classList.add('hidden');
            }
        });
    }

    if (endSessionBtn) {
        endSessionBtn.addEventListener('click', () => {
            if (!confirm("Are you sure you want to end this session?")) return;

            stopScanner();
            currentSessionId = null;

            if (sessionInfo) sessionInfo.classList.add('hidden');
            if (sessionControls) sessionControls.classList.add('hidden');
            if (scanContainer) scanContainer.classList.add('hidden');

            if (generateBtn) {
                generateBtn.classList.remove('hidden');
                generateBtn.disabled = false;
                generateBtn.textContent = 'Start New Session & Open Scanner';
            }
        });
    }

    function stopScanner() {
        isScanning = false;
        if (requestAnimationFrameId) {
            cancelAnimationFrame(requestAnimationFrameId);
            requestAnimationFrameId = null;
        }
        if (video && video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
        if (scanStatus) {
            scanStatus.textContent = "Scanning Stopped.";
            scanStatus.className = 'status-message';
        }
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshBtn.textContent = "↻ Refreshing...";
            loadDashboard(tableBody, currentSessionId).then(() => {
                setTimeout(() => refreshBtn.textContent = "↻ Refresh", 500);
            });
        });
    }

    // Also auto load dashboard if tableBody exists but we are on the global dashboard page
    if (tableBody && !generateBtn) {
        loadDashboard(tableBody, null);
    }

    function startScanner() {
        if (!video || !canvasElement || typeof jsQR === 'undefined') {
            if (scanStatus) scanStatus.textContent = "Error: QR Scanner library not loaded or DOM missing.";
            return;
        }

        isScanning = true;
        scannedCache = {}; // Clear cache on new session
        if (cameraLoading) cameraLoading.classList.remove("hidden");

        const constraints = {
            video: {
                facingMode: "environment",
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        };

        // Optimize resolution request for portrait mode on mobile
        if (window.innerHeight > window.innerWidth) {
            constraints.video.width = { ideal: 1080 };
            constraints.video.height = { ideal: 1920 };
        }

        navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
            video.srcObject = stream;
            video.setAttribute("playsinline", true);
            video.play();
            requestAnimationFrameId = requestAnimationFrame(tick);
        }).catch(function (err) {
            console.error("Camera access denied or error", err);
            if (scanStatus) scanStatus.textContent = "Error: Camera access denied.";
        });
    }

    function drawLine(begin, end, color) {
        canvas.beginPath();
        canvas.moveTo(begin.x, begin.y);
        canvas.lineTo(end.x, end.y);
        canvas.lineWidth = 4;
        canvas.strokeStyle = color;
        canvas.stroke();
    }

    function tick() {
        if (!isScanning) return;

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            if (cameraLoading) cameraLoading.classList.add("hidden");

            canvasElement.height = video.videoHeight;
            canvasElement.width = video.videoWidth;
            canvas.clearRect(0, 0, canvasElement.width, canvasElement.height); // clear to let native video show

            const now = Date.now();
            if (now - lastScanTime > 150) { // Faster scan rate for smoothness (~6.6 FPS)
                lastScanTime = now;

                // Downscale for jsQR performance
                const scale = Math.min(1, 600 / video.videoWidth);
                const scanWidth = Math.floor(video.videoWidth * scale);
                const scanHeight = Math.floor(video.videoHeight * scale);

                if (!window.scanCanvas) {
                    window.scanCanvas = document.createElement("canvas");
                    window.scanCtx = window.scanCanvas.getContext("2d", { willReadFrequently: true });
                }
                window.scanCanvas.width = scanWidth;
                window.scanCanvas.height = scanHeight;
                window.scanCtx.drawImage(video, 0, 0, scanWidth, scanHeight);

                var imageData = window.scanCtx.getImageData(0, 0, scanWidth, scanHeight);
                var code = jsQR(imageData.data, scanWidth, scanHeight, {
                    inversionAttempts: "dontInvert",
                });

                if (code) {
                    let displayName = null;
                    try {
                        let parsed = JSON.parse(code.data);
                        if (parsed.name && parsed.roll_no) displayName = parsed.name;
                    } catch (e) { }

                    const invScale = 1 / scale;
                    code.location.topLeftCorner.x *= invScale;
                    code.location.topLeftCorner.y *= invScale;
                    code.location.topRightCorner.x *= invScale;
                    code.location.topRightCorner.y *= invScale;
                    code.location.bottomRightCorner.x *= invScale;
                    code.location.bottomRightCorner.y *= invScale;
                    code.location.bottomLeftCorner.x *= invScale;
                    code.location.bottomLeftCorner.y *= invScale;

                    lastCode = Object.assign({}, code, { displayName });
                    processQRCode(code.data);
                } else {
                    lastCode = null;
                }
            }

            if (lastCode) {
                drawLine(lastCode.location.topLeftCorner, lastCode.location.topRightCorner, "#10b981");
                drawLine(lastCode.location.topRightCorner, lastCode.location.bottomRightCorner, "#10b981");
                drawLine(lastCode.location.bottomRightCorner, lastCode.location.bottomLeftCorner, "#10b981");
                drawLine(lastCode.location.bottomLeftCorner, lastCode.location.topLeftCorner, "#10b981");

                if (lastCode.displayName) {
                    canvas.font = "bold 24px Inter, sans-serif";
                    canvas.fillStyle = "#10b981";
                    canvas.shadowColor = "rgba(0,0,0,0.8)";
                    canvas.shadowBlur = 4;
                    canvas.fillText(lastCode.displayName, lastCode.location.topLeftCorner.x, lastCode.location.topLeftCorner.y - 14);
                    canvas.shadowBlur = 0;
                }
            }
        }
        requestAnimationFrameId = requestAnimationFrame(tick);
    }

    function showToast(message, type) {
        if (!toastContainer) return;
        const toast = document.createElement('div');
        toast.style.padding = '10px 15px';
        toast.style.marginBottom = '10px';
        toast.style.borderRadius = '8px';
        toast.style.color = '#fff';
        toast.style.fontSize = '0.9rem';
        toast.style.fontWeight = 'bold';
        toast.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
        toast.style.transition = 'opacity 0.3s ease-in-out';
        toast.textContent = message;

        if (type === 'success') {
            toast.style.background = '#10b981';
        } else if (type === 'warning') {
            toast.style.background = '#f59e0b';
        } else {
            toast.style.background = '#ef4444';
        }

        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toastContainer.removeChild(toast), 300);
        }, 3000);
    }

    async function processQRCode(decodedText) {
        try {
            const studentData = JSON.parse(decodedText);
            if (!studentData.roll_no) return;

            const now = Date.now();
            const lastScanned = scannedCache[studentData.roll_no] || 0;

            if (now - lastScanned < 5000) return; // 5 second cooling period

            scannedCache[studentData.roll_no] = now;

            if (scanStatus) {
                scanStatus.textContent = `Scanned ${studentData.name}. Marking...`;
                scanStatus.className = 'status-message status-success';
            }

            const response = await fetch(`${API_BASE_URL}/mark_attendance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roll_no: studentData.roll_no, session_id: currentSessionId })
            });

            if (response.ok) {
                scanCount++;
                if (scanCounter) scanCounter.textContent = scanCount;
                showToast(`✅ Marked: ${studentData.name}`, 'success');
                loadDashboard(tableBody, currentSessionId);
            } else if (response.status === 409) {
                showToast(`⚠️ Already Recorded: ${studentData.name}`, 'warning');
            } else {
                const result = await response.json();
                showToast(`❌ Failed: ${result.error}`, 'error');
            }

            setTimeout(() => {
                if (scanStatus) {
                    scanStatus.textContent = "Waiting for next QR code...";
                    scanStatus.className = 'status-message';
                }
            }, 2000);
        } catch (e) {
            // Not a valid JSON or other error, quietly pass
        }
    }
}

let pieChartInstance = null;
let barChartInstance = null;

async function loadAnalytics() {
    const analyticsSection = document.getElementById('analyticsSection');
    if (!analyticsSection) return;

    try {
        const res = await fetch(`${API_BASE_URL}/api/attendance_stats`);
        if (!res.ok) return;
        const data = await res.json();

        analyticsSection.style.display = 'block';
        document.getElementById('statTotal').textContent = data.total_students;
        document.getElementById('statPresent').textContent = data.present;
        document.getElementById('statAbsent').textContent = data.absent;

        const overallPercent = data.total_students > 0 ? Math.round((data.present / data.total_students) * 100) : 0;
        document.getElementById('statPercent').textContent = overallPercent + '%';

        const labels = data.students.map(s => s.name);
        const dataPoints = data.students.map(s => s.attendance);

        const ctxBar = document.getElementById('barChart').getContext('2d');
        if (barChartInstance) barChartInstance.destroy();
        barChartInstance = new Chart(ctxBar, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Attendance %',
                    data: dataPoints,
                    backgroundColor: 'rgba(59, 130, 246, 0.5)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, max: 100 }
                }
            }
        });

        const ctxPie = document.getElementById('pieChart').getContext('2d');
        if (pieChartInstance) pieChartInstance.destroy();
        pieChartInstance = new Chart(ctxPie, {
            type: 'doughnut',
            data: {
                labels: ['Present (Latest)', 'Absent (Latest)'],
                datasets: [{
                    data: [data.present, data.absent],
                    backgroundColor: ['rgba(16, 185, 129, 0.7)', 'rgba(239, 68, 68, 0.7)'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
            }
        });

    } catch (e) {
        console.error("Failed to load analytics", e);
    }
}

async function loadDashboard(tableBody, sessionId = null) {
    if (!tableBody) return;
    try {
        const url = sessionId ? `${API_BASE_URL}/session_attendance/${sessionId}` : `${API_BASE_URL}/attendance`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch data');
        const result = await response.json();

        // Reload analytics if on global dashboard
        if (!sessionId) {
            loadAnalytics();
        }

        tableBody.innerHTML = '';
        if (result.data.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" class="text-center p-8 text-slate-400 italic">No attendance records found.</td></tr>';
            return;
        }

        result.data.forEach(record => {
            const date = new Date(record.timestamp);
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="p-4 border-b border-slate-100"><strong>${escapeHtml(record.name)}</strong><br><small style="color:#94a3b8">${escapeHtml(record.class)}</small></td>
                <td class="p-4 border-b border-slate-100"><span class="font-mono text-slate-600 bg-slate-100 px-2 py-1 rounded-md text-xs">${escapeHtml(record.roll_no)}</span></td>
                <td class="p-4 border-b border-slate-100 hidden sm:table-cell text-slate-500">${date.toLocaleString()}</td>
                <td class="p-4 border-b border-slate-100 text-right"><span class="bg-green-100 text-green-700 font-semibold px-2 py-1 rounded-md text-xs">Present ${record.session_name ? 'in ' + escapeHtml(record.session_name) : ''}</span></td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error(error);
        tableBody.innerHTML = '<tr><td colspan="4" class="text-center status-error">Error loading data.</td></tr>';
    }
}

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    setupLogoutBtn();

    // Since server handles routing exactly via dashboard routes
    if (path.includes('teacher_dashboard') || path.includes('dashboard.html') || path.includes('teacher_portal')) {
        initTeacherDashboard();
    } else if (path.includes('student_dashboard') || path.includes('mark')) {
        initStudentView();
    }
});
