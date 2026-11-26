/* ============================================================================
   RMUTT 09412315 — Computer and Data Analysis (คอมพิวเตอร์และการวิเคราะห์ข้อมูล)
   Frontend Application — Connected to Google Apps Script Web App API
   ============================================================================ */

// *** สำคัญ: นำ Web App URL ที่ได้จากการ Deploy ไฟล์ Code.gs มาวางแทนที่ข้อความด้านล่าง ***
const API_URL = "https://script.google.com/macros/s/AKfycby-sam7w9YjhSiL7xbohd8ARdQhruUXKyV_HnV5O_Yk_2AiV7VYuy3NdVIGMiaEPLZXeg/exec";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "zip", "png", "jpg", "jpeg", "gif", "webp"
];
const SESSION_STORAGE_KEY = "rmutt_09412315_session_v1";

// ==================== Application State ====================
const state = {
  loginRole: "student",
  session: null,           // { token, user: { role, ... } }
  studentData: null,       // { student, assignments, server_time }
  teacherData: null,       // { teacher, students, assignments, submissions, root_folder_url }
  activeTeacherTab: "grading",
  uploadTarget: null,      // assignment object being uploaded
  selectedFile: null,      // File object
  assignmentModalMode: "create",
  gradeTarget: null        // { assignment, student, submission }
};

// ==================== API Communication ====================
function isApiConfigured() {
  return (
    typeof API_URL === "string" &&
    API_URL.startsWith("https://script.google.com/") &&
    !API_URL.includes("YOUR_APPS_SCRIPT_WEB_APP_URL_HERE")
  );
}

async function apiRequest(action, payload = {}, loadingMessage = "กำลังเชื่อมต่อข้อมูล...") {
  if (!isApiConfigured()) {
    throw new Error("ยังไม่ได้ตั้งค่า API_URL ในไฟล์ app.js กรุณานำ Web App URL จาก Google Apps Script มาใส่ก่อนใช้งาน");
  }

  showLoading(loadingMessage);
  try {
    const body = Object.assign({ action }, payload);
    if (state.session && state.session.token && !body.token) {
      body.token = state.session.token;
    }

    // ใช้ text/plain เพื่อหลีกเลี่ยง CORS Preflight (OPTIONS) เมื่อเรียก Apps Script จาก GitHub Pages
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow"
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      throw new Error("ระบบหลังบ้านตอบกลับไม่ถูกต้อง กรุณาตรวจสอบการตั้งค่า Deploy Web App (Who has access: Anyone)");
    }

    if (!data.ok) {
      if (data.error && (data.error.includes("เซสชันหมดอายุ") || data.error.includes("Token"))) {
        clearSession();
        renderCurrentView();
      }
      throw new Error(data.error || "เกิดข้อผิดพลาดในการดำเนินการ");
    }

    return data;
  } finally {
    hideLoading();
  }
}

// ==================== Utilities ====================
function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getExtension(fileName) {
  const idx = String(fileName || "").lastIndexOf(".");
  if (idx === -1 || idx === fileName.length - 1) return "";
  return fileName.slice(idx + 1).toLowerCase();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function buildPreviewFileName(assignmentId, fullName, originalFileName) {
  const ext = getExtension(originalFileName);
  const cleanAsg = String(assignmentId || "").trim().replace(/[\/\\:*?"<>|]+/g, "-");
  const cleanName = String(fullName || "").trim().replace(/\s+/g, "_").replace(/[\/\\:*?"<>|]+/g, "");
  return cleanAsg + "_" + cleanName + (ext ? "." + ext : "");
}

function parseThaiDeadlineDate(deadlineStr) {
  if (!deadlineStr) return null;
  const normalized = String(deadlineStr).trim().replace(" ", "T");
  const withSec = normalized.length === 16 ? normalized + ":59" : normalized;
  const iso = withSec.includes("+") || withSec.includes("Z") ? withSec : withSec + "+07:00";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function formatThaiDateTime(dateStr) {
  if (!dateStr) return "-";
  const d = parseThaiDeadlineDate(dateStr);
  if (!d) return dateStr;
  return d.toLocaleString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }) + " น.";
}

function toDatetimeLocalValue(deadlineStr) {
  if (!deadlineStr) return "";
  return String(deadlineStr).trim().replace(" ", "T").slice(0, 16);
}

function isPastDeadline(deadlineStr) {
  const d = parseThaiDeadlineDate(deadlineStr);
  if (!d) return false;
  return Date.now() > d.getTime();
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIdx = result.indexOf(",");
      resolve(commaIdx !== -1 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error("ไม่สามารถอ่านไฟล์ที่เลือกได้"));
    reader.readAsDataURL(file);
  });
}

function showLoading(msg) {
  const overlay = document.getElementById("loading-overlay");
  const textEl = document.getElementById("loading-text");
  if (textEl) textEl.textContent = msg || "กำลังประมวลผล...";
  if (overlay) overlay.classList.remove("hidden");
}

function hideLoading() {
  const overlay = document.getElementById("loading-overlay");
  if (overlay) overlay.classList.add("hidden");
}

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 4200);
}

// ==================== Session Management ====================
function saveSession(sessionObj) {
  state.session = sessionObj;
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionObj));
  } catch (_) {}
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function clearSession() {
  state.session = null;
  state.studentData = null;
  state.teacherData = null;
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (_) {}
}

// ==================== View Routing ====================
function renderCurrentView() {
  const viewLogin = document.getElementById("view-login");
  const viewStudent = document.getElementById("view-student");
  const viewTeacher = document.getElementById("view-teacher");
  const navUserArea = document.getElementById("nav-user-area");
  const navRoleTag = document.getElementById("nav-role-tag");
  const navUserName = document.getElementById("nav-user-name");

  viewLogin.classList.add("hidden");
  viewStudent.classList.add("hidden");
  viewTeacher.classList.add("hidden");

  if (!state.session || !state.session.user) {
    navUserArea.classList.add("hidden");
    viewLogin.classList.remove("hidden");
    return;
  }

  navUserArea.classList.remove("hidden");
  const user = state.session.user;

  if (user.role === "student") {
    navRoleTag.textContent = "นักศึกษา";
    navRoleTag.classList.remove("teacher");
    navUserName.textContent = user.full_name || user.student_id;
    viewStudent.classList.remove("hidden");
  } else {
    navRoleTag.textContent = "อาจารย์ผู้สอน";
    navRoleTag.classList.add("teacher");
    navUserName.textContent = user.teacher_name || user.username;
    viewTeacher.classList.remove("hidden");
  }
}

// ==================== Login Flow ====================
function setLoginRole(role) {
  state.loginRole = role;
  document.querySelectorAll("[data-login-role]").forEach((btn) => {
    const active = btn.getAttribute("data-login-role") === role;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });

  const userInput = document.getElementById("login-username");
  const submitBtn = document.getElementById("btn-login-submit");
  const errBox = document.getElementById("login-error");
  errBox.classList.add("hidden");

  if (role === "student") {
    userInput.placeholder = "กรอก Username ของนักศึกษา";
    submitBtn.textContent = "เข้าสู่ระบบ (นักศึกษา)";
  } else {
    userInput.placeholder = "กรอก Username ของอาจารย์ผู้สอน";
    submitBtn.textContent = "เข้าสู่ระบบ (อาจารย์ผู้สอน)";
  }
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const errBox = document.getElementById("login-error");
  errBox.classList.add("hidden");

  try {
    const res = await apiRequest(
      "login",
      { role: state.loginRole, username, password },
      "กำลังตรวจสอบสิทธิ์เข้าสู่ระบบ..."
    );

    saveSession({ token: res.token, user: res.user });
    document.getElementById("login-password").value = "";
    renderCurrentView();

    if (res.user.role === "student") {
      await loadStudentDashboard();
    } else {
      await loadTeacherDashboard();
    }
    showToast("เข้าสู่ระบบเรียบร้อยแล้ว", "success");
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove("hidden");
  }
}

// ==================== Student Dashboard ====================
async function loadStudentDashboard() {
  const res = await apiRequest("getStudentDashboard", {}, "กำลังโหลดข้อมูลงานของคุณ...");
  state.studentData = res;
  renderStudentDashboard();
}

function renderStudentDashboard() {
  const data = state.studentData;
  if (!data) return;

  document.getElementById("stu-profile-id").textContent = data.student.student_id || "-";
  document.getElementById("stu-profile-name").textContent = data.student.full_name || "-";

  const assignments = data.assignments || [];
  let submittedCount = 0;
  let gradedCount = 0;
  let totalScore = 0;
  let totalMax = 0;

  assignments.forEach((a) => {
    totalMax += Number(a.max_score) || 0;
    if (a.submission) {
      submittedCount++;
      if (a.submission.status === "graded") {
        gradedCount++;
        totalScore += Number(a.submission.score) || 0;
      }
    }
  });

  document.getElementById("stu-stats-grid").innerHTML = `
    <div class="stat-card">
      <div class="stat-label">งานทั้งหมด</div>
      <div class="stat-value">${assignments.length} งาน</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">ส่งแล้ว</div>
      <div class="stat-value text-blue">${submittedCount} / ${assignments.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">ตรวจแล้ว</div>
      <div class="stat-value text-green">${gradedCount} งาน</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">คะแนนสะสม</div>
      <div class="stat-value text-green">${totalScore} / ${totalMax}</div>
    </div>
  `;

  const listEl = document.getElementById("stu-assignment-list");
  if (!assignments.length) {
    listEl.innerHTML = `<div class="alert alert-info" style="margin-bottom:0;">ยังไม่มีรายการงานที่ได้รับมอบหมาย</div>`;
    return;
  }

  listEl.innerHTML = assignments
    .map((asg) => {
      const sub = asg.submission;
      const isClosed = asg.status !== "open";
      const overdueNow = isPastDeadline(asg.deadline);

      // สถานะ 3 ขั้นตอน: ยังไม่ส่ง -> ส่งแล้ว (รอตรวจ) -> ตรวจแล้ว
      let badgesHtml = "";
      if (!sub) {
        badgesHtml += `<span class="badge badge-pending">ยังไม่ส่ง</span>`;
        if (overdueNow) {
          badgesHtml += `<span class="badge badge-late">เลยกำหนดส่ง</span>`;
        }
      } else if (sub.status === "graded") {
        badgesHtml += `<span class="badge badge-graded">ตรวจแล้ว</span>`;
        if (sub.is_late) {
          badgesHtml += `<span class="badge badge-late">ส่งช้า</span>`;
        }
      } else {
        badgesHtml += `<span class="badge badge-submitted">ส่งแล้ว (รอตรวจ)</span>`;
        if (sub.is_late) {
          badgesHtml += `<span class="badge badge-late">ส่งช้า</span>`;
        }
      }

      if (isClosed) {
        badgesHtml += `<span class="badge badge-closed">ปิดรับงาน</span>`;
      }

      let submissionDetailHtml = "";
      if (sub) {
        const isGraded = sub.status === "graded";
        submissionDetailHtml = `
          <div class="submission-box ${isGraded ? "graded" : ""}">
            <div class="submission-file-line">
              <div>
                <strong>ไฟล์ที่ส่ง:</strong> ${escapeHtml(sub.file_name)}<br />
                <span style="font-size:0.86rem; color:var(--slate-600);">
                  เวลาที่ส่ง: ${escapeHtml(formatThaiDateTime(sub.submitted_at))}
                </span>
              </div>
              ${
                sub.file_url
                  ? `<a href="${escapeHtml(sub.file_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm">เปิดดูไฟล์ที่ส่ง</a>`
                  : ""
              }
            </div>
            ${
              isGraded && sub.feedback
                ? `<div class="feedback-box"><strong>ข้อเสนอแนะจากอาจารย์:</strong> ${escapeHtml(sub.feedback)}</div>`
                : ""
            }
          </div>
        `;
      }

      let actionHtml = "";
      let leftFooterHtml = "";

      if (sub && sub.status === "graded") {
        leftFooterHtml = `<span class="score-highlight">คะแนนที่ได้: ${sub.score} / ${asg.max_score} คะแนน</span>`;
        actionHtml = `<button type="button" class="btn btn-outline btn-sm" disabled>ตรวจแล้ว (ไม่สามารถแก้ไขได้)</button>`;
      } else if (isClosed) {
        leftFooterHtml = `<span style="color:var(--slate-500);">อาจารย์ปิดรับการส่งงานนี้แล้ว</span>`;
        actionHtml = `<button type="button" class="btn btn-outline btn-sm" disabled>ปิดรับงาน</button>`;
      } else if (sub) {
        leftFooterHtml = `<span style="color:var(--slate-600); font-size:0.88rem;">สามารถส่งไฟล์แก้ไขทับไฟล์เดิมได้จนกว่าอาจารย์จะตรวจ</span>`;
        actionHtml = `<button type="button" class="btn btn-sky btn-sm" data-open-upload="${escapeHtml(asg.assignment_id)}">ส่งไฟล์แก้ไขทับเดิม</button>`;
      } else {
        leftFooterHtml = `<span style="color:var(--slate-600); font-size:0.88rem;">โฟลเดอร์จัดเก็บ: <strong>${escapeHtml(asg.assignment_id)}</strong></span>`;
        actionHtml = `<button type="button" class="btn btn-primary btn-sm" data-open-upload="${escapeHtml(asg.assignment_id)}">เลือกไฟล์และส่งงาน</button>`;
      }

      return `
        <article class="assignment-card">
          <div class="assignment-top">
            <div>
              <span class="assignment-code">${escapeHtml(asg.assignment_id)}</span>
              <span class="assignment-title">${escapeHtml(asg.title)}</span>
            </div>
            <div class="badge-stack">${badgesHtml}</div>
          </div>

          ${asg.description ? `<p class="assignment-desc">${escapeHtml(asg.description)}</p>` : ""}

          <div class="assignment-meta-row">
            <span><strong>คะแนนเต็ม:</strong> ${asg.max_score} คะแนน</span>
            <span><strong>กำหนดส่ง (Deadline):</strong> ${escapeHtml(formatThaiDateTime(asg.deadline))}</span>
          </div>

          ${submissionDetailHtml}

          <div class="assignment-actions">
            <div>${leftFooterHtml}</div>
            <div>${actionHtml}</div>
          </div>
        </article>
      `;
    })
    .join("");
}

// ==================== Student Upload Modal ====================
function openUploadModal(assignmentId) {
  if (!state.studentData) return;
  const asg = state.studentData.assignments.find((a) => a.assignment_id === assignmentId);
  if (!asg) return;

  state.uploadTarget = asg;
  state.selectedFile = null;

  document.getElementById("modal-upload-title").textContent =
    (asg.submission ? "ส่งไฟล์แก้ไข: " : "ส่งงาน: ") + asg.assignment_id;
  document.getElementById("upload-assignment-summary").innerHTML =
    `<strong>${escapeHtml(asg.assignment_id)} — ${escapeHtml(asg.title)}</strong><br />` +
    `กำหนดส่ง: ${escapeHtml(formatThaiDateTime(asg.deadline))} · คะแนนเต็ม ${asg.max_score} คะแนน`;

  document.getElementById("upload-replace-notice").classList.toggle("hidden", !asg.submission);
  document.getElementById("upload-late-notice").classList.toggle("hidden", !isPastDeadline(asg.deadline));

  const fileInput = document.getElementById("upload-file-input");
  fileInput.value = "";
  document.getElementById("upload-file-preview").classList.add("hidden");
  document.getElementById("upload-error").classList.add("hidden");
  document.getElementById("btn-confirm-upload").disabled = true;

  openModal("modal-upload");
}

function handleFileSelection(file) {
  const previewEl = document.getElementById("upload-file-preview");
  const errEl = document.getElementById("upload-error");
  const confirmBtn = document.getElementById("btn-confirm-upload");

  errEl.classList.add("hidden");
  previewEl.classList.add("hidden");
  confirmBtn.disabled = true;
  state.selectedFile = null;

  if (!file || !state.uploadTarget || !state.studentData) return;

  const ext = getExtension(file.name);
  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
    errEl.textContent = `ไม่รองรับไฟล์นามสกุล .${ext || "(ไม่มี)"} (รองรับ: ${ALLOWED_EXTENSIONS.map((x) => "." + x).join(", ")})`;
    errEl.classList.remove("hidden");
    return;
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    errEl.textContent = `ไฟล์มีขนาด ${formatFileSize(file.size)} เกินขีดจำกัดสูงสุด 20 MB กรุณาลดขนาดไฟล์แล้วลองใหม่`;
    errEl.classList.remove("hidden");
    return;
  }

  state.selectedFile = file;
  const newFileName = buildPreviewFileName(
    state.uploadTarget.assignment_id,
    state.studentData.student.full_name,
    file.name
  );

  previewEl.innerHTML = `
    <div><strong>ไฟล์ที่เลือก:</strong> ${escapeHtml(file.name)} (${escapeHtml(formatFileSize(file.size))})</div>
    <div><strong>ชื่อไฟล์ที่จะบันทึกอัตโนมัติ:</strong> <span class="rename-highlight">${escapeHtml(newFileName)}</span></div>
    <div><strong>โฟลเดอร์ปลายทาง:</strong> Google Drive / ${escapeHtml(state.uploadTarget.assignment_id)}</div>
  `;
  previewEl.classList.remove("hidden");
  confirmBtn.disabled = false;
}

async function handleConfirmUpload() {
  if (!state.uploadTarget || !state.selectedFile) return;
  const errEl = document.getElementById("upload-error");
  errEl.classList.add("hidden");

  try {
    showLoading("กำลังเตรียมไฟล์สำหรับอัปโหลด...");
    const base64 = await readFileAsBase64(state.selectedFile);

    const res = await apiRequest(
      "submitWork",
      {
        assignment_id: state.uploadTarget.assignment_id,
        original_file_name: state.selectedFile.name,
        mime_type: state.selectedFile.type || "application/octet-stream",
        file_base64: base64
      },
      "กำลังอัปโหลดไฟล์ไปยัง Google Drive..."
    );

    closeModal("modal-upload");
    showToast(res.message || "ส่งงานเรียบร้อยแล้ว", "success");
    await loadStudentDashboard();
  } catch (err) {
    hideLoading();
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
}

// ==================== Teacher Dashboard ====================
async function loadTeacherDashboard() {
  const res = await apiRequest("getTeacherDashboard", {}, "กำลังโหลดข้อมูลฝั่งอาจารย์ผู้สอน...");
  state.teacherData = res;
  renderTeacherDashboard();
}

function renderTeacherDashboard() {
  const data = state.teacherData;
  if (!data) return;

  const driveLink = document.getElementById("teacher-drive-link");
  if (data.root_folder_url) {
    driveLink.href = data.root_folder_url;
    driveLink.classList.remove("hidden");
  }

  const students = data.students || [];
  const assignments = data.assignments || [];
  const submissions = data.submissions || [];

  const waitCount = submissions.filter((s) => s.status === "submitted").length;
  const gradedCount = submissions.filter((s) => s.status === "graded").length;

  document.getElementById("teacher-stats-grid").innerHTML = `
    <div class="stat-card">
      <div class="stat-label">นักศึกษาทั้งหมด</div>
      <div class="stat-value">${students.length} คน</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">งานที่มอบหมาย</div>
      <div class="stat-value">${assignments.length} งาน</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">ส่งแล้ว (รอตรวจ)</div>
      <div class="stat-value text-amber">${waitCount} ชิ้น</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">ตรวจให้คะแนนแล้ว</div>
      <div class="stat-value text-green">${gradedCount} ชิ้น</div>
    </div>
  `;

  populateAssignmentFilter();
  renderTeacherGradingTable();
  renderTeacherAssignmentsTable();
  renderTeacherScorebook();
}

function switchTeacherTab(tabName) {
  state.activeTeacherTab = tabName;
  document.querySelectorAll("[data-teacher-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-teacher-tab") === tabName);
  });

  document.getElementById("teacher-panel-grading").classList.toggle("hidden", tabName !== "grading");
  document.getElementById("teacher-panel-assignments").classList.toggle("hidden", tabName !== "assignments");
  document.getElementById("teacher-panel-scorebook").classList.toggle("hidden", tabName !== "scorebook");
}

function populateAssignmentFilter() {
  const sel = document.getElementById("filter-assignment");
  const prevVal = sel.value;
  const assignments = (state.teacherData && state.teacherData.assignments) || [];

  let html = `<option value="all">ทุกงาน (${assignments.length} งาน)</option>`;
  assignments.forEach((a) => {
    html += `<option value="${escapeHtml(a.assignment_id)}">${escapeHtml(a.assignment_id)} — ${escapeHtml(a.title)}</option>`;
  });
  sel.innerHTML = html;

  if (prevVal && (prevVal === "all" || assignments.some((a) => a.assignment_id === prevVal))) {
    sel.value = prevVal;
  } else if (assignments.length > 0) {
    sel.value = assignments[0].assignment_id;
  }
}

function renderTeacherGradingTable() {
  const wrap = document.getElementById("teacher-grading-table-wrap");
  if (!state.teacherData) return;

  const { students, assignments, submissions } = state.teacherData;
  const filterAsg = document.getElementById("filter-assignment").value || "all";
  const filterStatus = document.getElementById("filter-status").value || "all";
  const search = (document.getElementById("filter-search").value || "").trim().toLowerCase();

  const subMap = {};
  submissions.forEach((s) => {
    subMap[s.assignment_id + "__" + s.student_id] = s;
  });

  const targetAssignments = filterAsg === "all"
    ? assignments
    : assignments.filter((a) => a.assignment_id === filterAsg);

  const rows = [];
  targetAssignments.forEach((asg) => {
    students.forEach((stu) => {
      const sub = subMap[asg.assignment_id + "__" + stu.student_id] || null;
      const statusKey = !sub ? "pending" : sub.status;

      if (filterStatus === "submitted" && statusKey !== "submitted") return;
      if (filterStatus === "graded" && statusKey !== "graded") return;
      if (filterStatus === "pending" && statusKey !== "pending") return;
      if (filterStatus === "late" && (!sub || !sub.is_late)) return;

      if (search) {
        const hay = `${stu.student_id} ${stu.full_name} ${asg.assignment_id}`.toLowerCase();
        if (!hay.includes(search)) return;
      }

      rows.push({ asg, stu, sub });
    });
  });

  if (!rows.length) {
    wrap.innerHTML = `<div style="padding:20px; text-align:center; color:var(--slate-500);">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</div>`;
    return;
  }

  let tbody = "";
  rows.forEach(({ asg, stu, sub }) => {
    const key = escapeHtml(asg.assignment_id + "__" + stu.student_id);
    let statusHtml = "";
    if (!sub) {
      statusHtml = `<span class="badge badge-pending">ยังไม่ส่ง</span>`;
    } else if (sub.status === "graded") {
      statusHtml = `<span class="badge badge-graded">ตรวจแล้ว</span>`;
      if (sub.is_late) statusHtml += ` <span class="badge badge-late">ส่งช้า</span>`;
    } else {
      statusHtml = `<span class="badge badge-submitted">ส่งแล้ว (รอตรวจ)</span>`;
      if (sub.is_late) statusHtml += ` <span class="badge badge-late">ส่งช้า</span>`;
    }

    const fileCell = sub
      ? `
        <a href="${escapeHtml(sub.file_url)}" target="_blank" rel="noopener noreferrer" style="font-weight:600;">
          ${escapeHtml(sub.file_name)}
        </a>
        <div style="font-size:0.82rem; color:var(--slate-500);">${escapeHtml(formatThaiDateTime(sub.submitted_at))}</div>
      `
      : `<span style="color:var(--slate-500);">-</span>`;

    const scoreCell = sub
      ? `
        <div style="display:flex; align-items:center; justify-content:center; gap:5px;">
          <input
            type="number"
            min="0"
            max="${asg.max_score}"
            step="0.5"
            class="inline-score-input"
            data-inline-score="${key}"
            value="${sub.score !== null && sub.score !== undefined ? sub.score : ""}"
            placeholder="-"
          />
          <span style="color:var(--slate-500); font-size:0.86rem;">/ ${asg.max_score}</span>
        </div>
      `
      : `<span style="color:var(--slate-500);">-</span>`;

    const feedbackCell = sub
      ? `
        <input
          type="text"
          class="inline-feedback-input"
          data-inline-feedback="${key}"
          value="${escapeHtml(sub.feedback || "")}"
          placeholder="ข้อเสนอแนะ..."
        />
      `
      : `<span style="color:var(--slate-500);">-</span>`;

    const actionCell = sub
      ? `
        <div style="display:flex; gap:6px; justify-content:center;">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            data-quick-grade-asg="${escapeHtml(asg.assignment_id)}"
            data-quick-grade-stu="${escapeHtml(stu.student_id)}"
          >บันทึก</button>
          <button
            type="button"
            class="btn btn-outline btn-sm"
            data-open-grade-asg="${escapeHtml(asg.assignment_id)}"
            data-open-grade-stu="${escapeHtml(stu.student_id)}"
          >ตรวจละเอียด</button>
        </div>
      `
      : `<span style="color:var(--slate-500); font-size:0.86rem;">รอส่งงาน</span>`;

    tbody += `
      <tr>
        <td class="nowrap"><strong>${escapeHtml(asg.assignment_id)}</strong></td>
        <td class="nowrap">${escapeHtml(stu.student_id)}</td>
        <td>${escapeHtml(stu.full_name)}</td>
        <td class="nowrap">${statusHtml}</td>
        <td>${fileCell}</td>
        <td class="text-center nowrap">${scoreCell}</td>
        <td>${feedbackCell}</td>
        <td class="text-center nowrap">${actionCell}</td>
      </tr>
    `;
  });

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>รหัสงาน</th>
          <th>รหัสนักศึกษา</th>
          <th>ชื่อ - นามสกุล</th>
          <th>สถานะ</th>
          <th>ไฟล์ที่ส่ง / เวลาส่ง</th>
          <th class="text-center">คะแนน</th>
          <th>ข้อเสนอแนะ</th>
          <th class="text-center">จัดการ</th>
        </tr>
      </thead>
      <tbody>${tbody}</tbody>
    </table>
  `;
}

async function handleQuickGrade(assignmentId, studentId) {
  const key = assignmentId + "__" + studentId;
  const scoreInput = document.querySelector(`[data-inline-score="${CSS.escape(key)}"]`);
  const feedbackInput = document.querySelector(`[data-inline-feedback="${CSS.escape(key)}"]`);
  if (!scoreInput) return;

  const scoreVal = scoreInput.value.trim();
  const feedbackVal = feedbackInput ? feedbackInput.value.trim() : "";

  if (scoreVal === "") {
    showToast("กรุณากรอกคะแนนก่อนกดบันทึก", "warning");
    scoreInput.focus();
    return;
  }

  try {
    const res = await apiRequest(
      "gradeSubmission",
      {
        assignment_id: assignmentId,
        student_id: studentId,
        score: Number(scoreVal),
        feedback: feedbackVal
      },
      "กำลังบันทึกคะแนน..."
    );
    showToast(res.message || "บันทึกคะแนนเรียบร้อยแล้ว", "success");
    await loadTeacherDashboard();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openGradeModal(assignmentId, studentId) {
  if (!state.teacherData) return;
  const asg = state.teacherData.assignments.find((a) => a.assignment_id === assignmentId);
  const stu = state.teacherData.students.find((s) => s.student_id === studentId);
  const sub = state.teacherData.submissions.find(
    (s) => s.assignment_id === assignmentId && s.student_id === studentId
  );
  if (!asg || !stu || !sub) return;

  state.gradeTarget = { asg, stu, sub };
  document.getElementById("modal-grade-title").textContent = `ตรวจงาน ${asg.assignment_id} — ${stu.full_name}`;
  document.getElementById("grade-modal-info").innerHTML = `
    <div><strong>นักศึกษา:</strong> ${escapeHtml(stu.student_id)} · ${escapeHtml(stu.full_name)}</div>
    <div><strong>ไฟล์งาน:</strong> <a href="${escapeHtml(sub.file_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sub.file_name)}</a></div>
    <div><strong>เวลาส่ง:</strong> ${escapeHtml(formatThaiDateTime(sub.submitted_at))} ${sub.is_late ? '<span class="badge badge-late" style="margin-left:6px;">ส่งช้า</span>' : ""}</div>
  `;
  document.getElementById("grade-max-label").textContent = `เต็ม ${asg.max_score} คะแนน`;

  const scoreEl = document.getElementById("grade-score-input");
  scoreEl.max = asg.max_score;
  scoreEl.value = sub.score !== null && sub.score !== undefined ? sub.score : "";
  document.getElementById("grade-feedback-input").value = sub.feedback || "";
  document.getElementById("grade-modal-error").classList.add("hidden");

  openModal("modal-grade");
}

async function handleGradeFormSubmit(e) {
  e.preventDefault();
  if (!state.gradeTarget) return;

  const { asg, stu } = state.gradeTarget;
  const scoreVal = document.getElementById("grade-score-input").value.trim();
  const feedbackVal = document.getElementById("grade-feedback-input").value.trim();
  const errEl = document.getElementById("grade-modal-error");
  errEl.classList.add("hidden");

  try {
    const res = await apiRequest(
      "gradeSubmission",
      {
        assignment_id: asg.assignment_id,
        student_id: stu.student_id,
        score: Number(scoreVal),
        feedback: feedbackVal
      },
      "กำลังบันทึกคะแนนและข้อเสนอแนะ..."
    );
    closeModal("modal-grade");
    showToast(res.message || "บันทึกคะแนนเรียบร้อยแล้ว", "success");
    await loadTeacherDashboard();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
}

// ==================== Teacher Manage Assignments ====================
function renderTeacherAssignmentsTable() {
  const wrap = document.getElementById("teacher-assignments-table-wrap");
  if (!state.teacherData) return;

  const { assignments, submissions, students } = state.teacherData;
  if (!assignments.length) {
    wrap.innerHTML = `<div style="padding:20px; text-align:center; color:var(--slate-500);">ยังไม่มีรายการงาน กดปุ่ม "+ เพิ่มงานใหม่" เพื่อเริ่มต้น</div>`;
    return;
  }

  let tbody = "";
  assignments.forEach((asg) => {
    const asgSubs = submissions.filter((s) => s.assignment_id === asg.assignment_id);
    const gradedCnt = asgSubs.filter((s) => s.status === "graded").length;
    const isOpen = asg.status === "open";

    tbody += `
      <tr>
        <td class="nowrap"><strong>${escapeHtml(asg.assignment_id)}</strong></td>
        <td>
          <div style="font-weight:700; color:var(--navy-900);">${escapeHtml(asg.title)}</div>
          ${asg.description ? `<div style="font-size:0.86rem; color:var(--slate-600);">${escapeHtml(asg.description)}</div>` : ""}
        </td>
        <td class="text-center nowrap"><strong>${asg.max_score}</strong></td>
        <td class="nowrap">${escapeHtml(formatThaiDateTime(asg.deadline))}</td>
        <td class="text-center nowrap">
          ${asgSubs.length} / ${students.length}
          <div style="font-size:0.82rem; color:var(--slate-500);">ตรวจแล้ว ${gradedCnt}</div>
        </td>
        <td class="text-center nowrap">
          <span class="badge ${isOpen ? "badge-open" : "badge-closed"}">
            ${isOpen ? "เปิดรับงาน" : "ปิดรับงาน"}
          </span>
        </td>
        <td class="text-center nowrap">
          <div style="display:flex; gap:6px; justify-content:center; flex-wrap:wrap;">
            ${
              asg.folder_url
                ? `<a href="${escapeHtml(asg.folder_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-sky btn-sm">โฟลเดอร์</a>`
                : ""
            }
            <button type="button" class="btn btn-outline btn-sm" data-edit-asg="${escapeHtml(asg.assignment_id)}">แก้ไข</button>
            <button
              type="button"
              class="btn ${isOpen ? "btn-danger-outline" : "btn-primary"} btn-sm"
              data-toggle-asg="${escapeHtml(asg.assignment_id)}"
              data-next-status="${isOpen ? "closed" : "open"}"
            >${isOpen ? "ปิดรับงาน" : "เปิดรับงาน"}</button>
          </div>
        </td>
      </tr>
    `;
  });

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>รหัสงาน</th>
          <th>หัวข้อและคำอธิบาย</th>
          <th class="text-center">คะแนนเต็ม</th>
          <th>กำหนดส่ง (Deadline)</th>
          <th class="text-center">ส่งแล้ว</th>
          <th class="text-center">สถานะ</th>
          <th class="text-center">จัดการ</th>
        </tr>
      </thead>
      <tbody>${tbody}</tbody>
    </table>
  `;
}

function suggestNextAssignmentId() {
  const assignments = (state.teacherData && state.teacherData.assignments) || [];
  let maxNum = 0;
  assignments.forEach((a) => {
    const m = String(a.assignment_id || "").match(/(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });
  const next = String(maxNum + 1).padStart(2, "0");
  return `งาน-${next}`;
}

function openAssignmentModal(mode, assignmentId = null) {
  state.assignmentModalMode = mode;
  const errEl = document.getElementById("assignment-form-error");
  errEl.classList.add("hidden");

  const idInput = document.getElementById("asg-id");
  const titleInput = document.getElementById("asg-title");
  const descInput = document.getElementById("asg-desc");
  const maxInput = document.getElementById("asg-max-score");
  const deadlineInput = document.getElementById("asg-deadline");
  const statusSelect = document.getElementById("asg-status");

  if (mode === "edit" && assignmentId && state.teacherData) {
    const asg = state.teacherData.assignments.find((a) => a.assignment_id === assignmentId);
    if (!asg) return;
    document.getElementById("modal-assignment-title").textContent = `แก้ไขงาน: ${asg.assignment_id}`;
    idInput.value = asg.assignment_id;
    idInput.readOnly = true;
    idInput.style.background = "var(--slate-100)";
    titleInput.value = asg.title;
    descInput.value = asg.description || "";
    maxInput.value = asg.max_score;
    deadlineInput.value = toDatetimeLocalValue(asg.deadline);
    statusSelect.value = asg.status;
  } else {
    document.getElementById("modal-assignment-title").textContent = "เพิ่มงานใหม่";
    idInput.value = suggestNextAssignmentId();
    idInput.readOnly = false;
    idInput.style.background = "var(--white)";
    titleInput.value = "";
    descInput.value = "";
    maxInput.value = "10";
    // ค่าเริ่มต้น Deadline = อีก 7 วัน เวลา 23:59
    const defaultDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const yyyy = defaultDate.getFullYear();
    const mm = String(defaultDate.getMonth() + 1).padStart(2, "0");
    const dd = String(defaultDate.getDate()).padStart(2, "0");
    deadlineInput.value = `${yyyy}-${mm}-${dd}T23:59`;
    statusSelect.value = "open";
  }

  openModal("modal-assignment");
}

async function handleAssignmentFormSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById("assignment-form-error");
  errEl.classList.add("hidden");

  const payload = {
    mode: state.assignmentModalMode,
    assignment_id: document.getElementById("asg-id").value.trim(),
    title: document.getElementById("asg-title").value.trim(),
    description: document.getElementById("asg-desc").value.trim(),
    max_score: Number(document.getElementById("asg-max-score").value),
    deadline: document.getElementById("asg-deadline").value,
    status: document.getElementById("asg-status").value
  };

  try {
    const res = await apiRequest(
      "saveAssignment",
      payload,
      state.assignmentModalMode === "edit"
        ? "กำลังบันทึกการแก้ไขงาน..."
        : "กำลังสร้างงานใหม่และสร้างโฟลเดอร์บน Google Drive..."
    );
    closeModal("modal-assignment");
    showToast(res.message || "บันทึกงานเรียบร้อยแล้ว", "success");
    await loadTeacherDashboard();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
}

async function handleToggleAssignment(assignmentId, nextStatus) {
  try {
    const res = await apiRequest(
      "toggleAssignmentStatus",
      { assignment_id: assignmentId, status: nextStatus },
      "กำลังอัปเดตสถานะงาน..."
    );
    showToast(res.message || "อัปเดตสถานะงานแล้ว", "success");
    await loadTeacherDashboard();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ==================== Teacher Class Scorebook & CSV Export ====================
function renderTeacherScorebook() {
  const wrap = document.getElementById("teacher-scorebook-table-wrap");
  if (!state.teacherData) return;

  const { students, assignments, submissions } = state.teacherData;
  const subMap = {};
  submissions.forEach((s) => {
    subMap[s.assignment_id + "__" + s.student_id] = s;
  });

  const totalMax = assignments.reduce((acc, a) => acc + (Number(a.max_score) || 0), 0);

  let thead = `
    <tr>
      <th class="text-center" style="width:54px;">ลำดับ</th>
      <th>รหัสนักศึกษา</th>
      <th>ชื่อ - นามสกุล</th>
      ${assignments
        .map(
          (a) =>
            `<th class="text-center">${escapeHtml(a.assignment_id)}<br /><span style="font-size:0.78rem; font-weight:500; opacity:0.85;">(เต็ม ${a.max_score})</span></th>`
        )
        .join("")}
      <th class="text-center">รวมคะแนน<br /><span style="font-size:0.78rem; font-weight:500; opacity:0.85;">(เต็ม ${totalMax})</span></th>
      <th class="text-center">ร้อยละ (%)</th>
    </tr>
  `;

  let tbody = "";
  students.forEach((stu, idx) => {
    let sum = 0;
    const cols = assignments
      .map((a) => {
        const sub = subMap[a.assignment_id + "__" + stu.student_id];
        if (!sub) {
          return `<td class="text-center score-cell-empty">-</td>`;
        }
        if (sub.status === "graded" && sub.score !== null && sub.score !== undefined) {
          sum += Number(sub.score) || 0;
          return `<td class="text-center score-cell-graded">${sub.score}</td>`;
        }
        return `<td class="text-center score-cell-wait">รอตรวจ</td>`;
      })
      .join("");

    const pct = totalMax > 0 ? ((sum / totalMax) * 100).toFixed(1) : "0.0";

    tbody += `
      <tr>
        <td class="text-center">${idx + 1}</td>
        <td class="nowrap">${escapeHtml(stu.student_id)}</td>
        <td class="nowrap" style="font-weight:500; color:var(--slate-900);">${escapeHtml(stu.full_name)}</td>
        ${cols}
        <td class="text-center score-cell-graded">${sum}</td>
        <td class="text-center score-cell-graded">${pct}%</td>
      </tr>
    `;
  });

  wrap.innerHTML = `
    <table class="data-table">
      <thead>${thead}</thead>
      <tbody>${tbody}</tbody>
    </table>
  `;
}

function exportScorebookCsv() {
  if (!state.teacherData) return;
  const { students, assignments, submissions } = state.teacherData;
  const subMap = {};
  submissions.forEach((s) => {
    subMap[s.assignment_id + "__" + s.student_id] = s;
  });

  const totalMax = assignments.reduce((acc, a) => acc + (Number(a.max_score) || 0), 0);
  const csvEscape = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;

  const headerRow = [
    "ลำดับ",
    "รหัสนักศึกษา",
    "ชื่อ-นามสกุล",
    ...assignments.map((a) => `${a.assignment_id} (${a.max_score})`),
    `รวมคะแนน (${totalMax})`,
    "ร้อยละ (%)"
  ];

  const lines = [headerRow.map(csvEscape).join(",")];

  students.forEach((stu, idx) => {
    let sum = 0;
    const scoreCols = assignments.map((a) => {
      const sub = subMap[a.assignment_id + "__" + stu.student_id];
      if (!sub) return "";
      if (sub.status === "graded" && sub.score !== null && sub.score !== undefined) {
        sum += Number(sub.score) || 0;
        return sub.score;
      }
      return "รอตรวจ";
    });
    const pct = totalMax > 0 ? ((sum / totalMax) * 100).toFixed(1) : "0.0";

    lines.push(
      [idx + 1, stu.student_id, stu.full_name, ...scoreCols, sum, pct]
        .map(csvEscape)
        .join(",")
    );
  });

  // ใส่ UTF-8 BOM (\uFEFF) เพื่อให้เปิดภาษาไทยใน Microsoft Excel ได้ถูกต้องทันที
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `คะแนนรวม_09412315_2-2569.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast("ดาวน์โหลดไฟล์ CSV เรียบร้อยแล้ว", "success");
}

// ==================== Modal Helpers ====================
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("hidden");
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("hidden");
}

// ==================== Event Listeners & Initialization ====================
function bindEvents() {
  // Login role tabs
  document.querySelectorAll("[data-login-role]").forEach((btn) => {
    btn.addEventListener("click", () => setLoginRole(btn.getAttribute("data-login-role")));
  });

  // Login form
  document.getElementById("login-form").addEventListener("submit", handleLoginSubmit);

  // Logout & Refresh
  document.getElementById("btn-logout").addEventListener("click", () => {
    clearSession();
    renderCurrentView();
    showToast("ออกจากระบบเรียบร้อยแล้ว", "info");
  });

  document.getElementById("btn-refresh").addEventListener("click", async () => {
    if (!state.session) return;
    try {
      if (state.session.user.role === "student") {
        await loadStudentDashboard();
      } else {
        await loadTeacherDashboard();
      }
      showToast("อัปเดตข้อมูลล่าสุดเรียบร้อยแล้ว", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Teacher sub-tabs
  document.querySelectorAll("[data-teacher-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTeacherTab(btn.getAttribute("data-teacher-tab")));
  });

  // Teacher grading filters
  document.getElementById("filter-assignment").addEventListener("change", renderTeacherGradingTable);
  document.getElementById("filter-status").addEventListener("change", renderTeacherGradingTable);
  document.getElementById("filter-search").addEventListener("input", renderTeacherGradingTable);

  // Add assignment buttons
  document.getElementById("btn-open-add-assignment").addEventListener("click", () => openAssignmentModal("create"));
  document.getElementById("btn-open-add-assignment-2").addEventListener("click", () => openAssignmentModal("create"));
  document.getElementById("assignment-form").addEventListener("submit", handleAssignmentFormSubmit);

  // Grade form modal
  document.getElementById("grade-form").addEventListener("submit", handleGradeFormSubmit);

  // Export CSV
  document.getElementById("btn-export-csv").addEventListener("click", exportScorebookCsv);

  // Upload dropzone & file input
  const dropzone = document.getElementById("upload-dropzone");
  const fileInput = document.getElementById("upload-file-input");

  dropzone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files[0]) {
      handleFileSelection(fileInput.files[0]);
    }
  });

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  });

  document.getElementById("btn-confirm-upload").addEventListener("click", handleConfirmUpload);

  // Close modal buttons & backdrop click
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.getAttribute("data-close-modal")));
  });
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) backdrop.classList.add("hidden");
    });
  });

  // Event delegation for dynamically rendered buttons
  document.addEventListener("click", (e) => {
    const uploadBtn = e.target.closest("[data-open-upload]");
    if (uploadBtn) {
      openUploadModal(uploadBtn.getAttribute("data-open-upload"));
      return;
    }

    const quickGradeBtn = e.target.closest("[data-quick-grade-asg]");
    if (quickGradeBtn) {
      handleQuickGrade(
        quickGradeBtn.getAttribute("data-quick-grade-asg"),
        quickGradeBtn.getAttribute("data-quick-grade-stu")
      );
      return;
    }

    const openGradeBtn = e.target.closest("[data-open-grade-asg]");
    if (openGradeBtn) {
      openGradeModal(
        openGradeBtn.getAttribute("data-open-grade-asg"),
        openGradeBtn.getAttribute("data-open-grade-stu")
      );
      return;
    }

    const editAsgBtn = e.target.closest("[data-edit-asg]");
    if (editAsgBtn) {
      openAssignmentModal("edit", editAsgBtn.getAttribute("data-edit-asg"));
      return;
    }

    const toggleAsgBtn = e.target.closest("[data-toggle-asg]");
    if (toggleAsgBtn) {
      handleToggleAssignment(
        toggleAsgBtn.getAttribute("data-toggle-asg"),
        toggleAsgBtn.getAttribute("data-next-status")
      );
    }
  });
}

async function init() {
  bindEvents();

  if (!isApiConfigured()) {
    document.getElementById("api-config-warning").classList.remove("hidden");
  }

  const saved = loadSession();
  if (saved && saved.token && saved.user) {
    state.session = saved;
    renderCurrentView();
    try {
      if (saved.user.role === "student") {
        await loadStudentDashboard();
      } else {
        await loadTeacherDashboard();
      }
    } catch (err) {
      clearSession();
      renderCurrentView();
      showToast(err.message, "warning");
    }
  } else {
    renderCurrentView();
  }
}

document.addEventListener("DOMContentLoaded", init);
