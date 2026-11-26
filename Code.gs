/**
 * ============================================================================
 * ระบบส่งงานนักศึกษา — รายวิชา 09412315 คอมพิวเตอร์และการวิเคราะห์ข้อมูล
 * (Computer and Data Analysis) ภาคการศึกษา 2/2569
 * ผู้สอน: ผศ.ดร.ศราวุธ ใจเย็น
 *
 * วิธีติดตั้งแบบย่อ:
 * 1. สร้าง Google Sheet ใหม่ -> เปิดเมนู Extensions > Apps Script
 * 2. วางโค้ดนี้ทั้งหมดลงในไฟล์ Code.gs แล้วกดบันทึก (Ctrl+S)
 * 3. (ไม่บังคับ) หากต้องการระบุโฟลเดอร์หลักบน Google Drive เอง ให้นำ Folder ID มาใส่ใน ROOT_FOLDER_ID
 *    หากเว้นว่าง "" ระบบจะสร้างโฟลเดอร์ชื่อ "09412315_ระบบส่งงาน_2-2569" ให้อัตโนมัติเมื่อรัน setupSystem
 * 4. เลือกฟังก์ชัน setupSystem ด้านบนแล้วกด Run (อนุญาตสิทธิ์เข้าถึง Google Sheets และ Drive)
 * 5. กด Deploy > New deployment > Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. คัดลอก Web App URL ไปวางที่ตัวแปร API_URL ในไฟล์ app.js ของฝั่ง GitHub Pages
 * ============================================================================
 */

// ==================== การตั้งค่าระบบ (CONFIGURATION) ====================

// เว้นว่าง "" หากผูกสคริปต์นี้กับ Google Sheet โดยตรง (แนะนำ)
// หรือใส่ Spreadsheet ID หากสร้างสคริปต์แบบแยกไฟล์
const SPREADSHEET_ID = "";

// ใส่ Folder ID ของโฟลเดอร์หลักใน Google Drive ที่ต้องการเก็บไฟล์งานทั้งหมด
// หากเว้นว่าง "" ฟังก์ชัน setupSystem() จะสร้างโฟลเดอร์ใหม่ให้อัตโนมัติและจำค่าไว้ใน Script Properties
const ROOT_FOLDER_ID = "";

// อนุญาตให้เปิดดูไฟล์ผ่านลิงก์ได้ (View only) เพื่อให้นักศึกษาและอาจารย์คลิกดูไฟล์ที่ส่งได้สะดวก
// หากต้องการจำกัดสิทธิ์ให้เปิดดูได้เฉพาะบัญชีเจ้าของ Google Drive (อาจารย์) ให้เปลี่ยนเป็น false
const SHARE_UPLOADED_FILE_BY_LINK = true;

// เขตเวลาและขีดจำกัดไฟล์
const TIMEZONE = "Asia/Bangkok";
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "zip", "png", "jpg", "jpeg", "gif", "webp"
];

// อายุของ Token การเข้าสู่ระบบ (12 ชั่วโมง)
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

// ชื่อแท็บ (Sheet) ทั้ง 4 แท็บใน Google Sheet
const SHEETS = {
  STUDENTS: "Students",
  TEACHERS: "Teachers",
  ASSIGNMENTS: "Assignments",
  SUBMISSIONS: "Submissions"
};

// หัวคอลัมน์มาตรฐานของแต่ละแท็บ
const HEADERS = {
  Students: ["student_id", "full_name", "username", "password"],
  Teachers: ["teacher_name", "username", "password"],
  Assignments: [
    "assignment_id", "title", "description", "max_score",
    "deadline", "status", "folder_id", "created_at"
  ],
  Submissions: [
    "submission_id", "assignment_id", "student_id", "student_name",
    "file_name", "file_id", "file_url", "submitted_at", "is_late",
    "status", "score", "feedback", "graded_at", "graded_by"
  ]
};

// ==================== 1. ฟังก์ชันติดตั้งระบบครั้งแรก ====================

/**
 * กดรันฟังก์ชันนี้ครั้งเดียว เพื่อสร้างแท็บทั้ง 4 แท็บ หัวคอลัมน์ รูปแบบเซลล์
 * โฟลเดอร์หลักบน Google Drive โฟลเดอร์งานเริ่มต้น และข้อมูลตัวอย่าง
 * (หากมีแท็บหรือข้อมูลอยู่แล้ว ระบบจะไม่ลบข้อมูลเดิม)
 */
function setupSystem() {
  const ss = getSpreadsheet_();
  const props = PropertiesService.getScriptProperties();

  // สร้าง Secret Key สำหรับเซ็น Token หากยังไม่มี
  if (!props.getProperty("AUTH_SECRET")) {
    props.setProperty("AUTH_SECRET", Utilities.getUuid() + "-" + Utilities.getUuid());
  }

  // สร้างหรือเชื่อมโยงโฟลเดอร์หลักบน Google Drive
  const rootFolder = getOrCreateRootFolder_();

  // 1) สร้างแท็บทั้ง 4 แท็บพร้อมจัดหัวตารางและรูปแบบคอลัมน์ข้อความ
  const studentsSheet = ensureSheet_(ss, SHEETS.STUDENTS, HEADERS.Students, [1, 2, 3, 4]);
  const teachersSheet = ensureSheet_(ss, SHEETS.TEACHERS, HEADERS.Teachers, [1, 2, 3]);
  const assignmentsSheet = ensureSheet_(ss, SHEETS.ASSIGNMENTS, HEADERS.Assignments, [1, 2, 3, 5, 6, 7, 8]);
  ensureSheet_(ss, SHEETS.SUBMISSIONS, HEADERS.Submissions, [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 14]);

  // 2) เพิ่มบัญชีอาจารย์เริ่มต้น (หากยังไม่มีข้อมูล)
  if (teachersSheet.getLastRow() < 2) {
    teachersSheet.appendRow(["ผศ.ดร.ศราวุธ ใจเย็น", "teacher", "admin1234"]);
  }

  // 3) เพิ่มรายชื่อนักศึกษาตัวอย่าง (หากยังไม่มีข้อมูล — ลบหรือแก้ไขเป็นรายชื่อจริงได้ทันที)
  if (studentsSheet.getLastRow() < 2) {
    const sampleStudents = [
      ["116810908102-0", "นายจารุกิตติ์ สมัน", "stu01", "1234"],
      ["116810908103-8", "นางสาวกนกพรรณ ชุมพล", "stu02", "1234"],
      ["116810908105-3", "นางสาวบุญยาพร มั่งผล", "stu03", "1234"]
    ];
    studentsSheet.getRange(2, 1, sampleStudents.length, 4).setNumberFormat("@").setValues(sampleStudents);
  }

  // 4) เพิ่มงานเริ่มต้น (งาน-01, งาน-02, งาน-03) พร้อมสร้างโฟลเดอร์ย่อยบน Google Drive อัตโนมัติ
  if (assignmentsSheet.getLastRow() < 2) {
    const nowStr = formatNow_();
    const initialAssignments = [
      ["งาน-01", "พื้นฐานการใช้คอมพิวเตอร์และการจัดการชุดข้อมูล", "จัดเตรียมและทำความสะอาดชุดข้อมูลดิบ ส่งเป็นไฟล์ .xlsx หรือ .pdf", 10, "2026-12-15 23:59", "open"],
      ["งาน-02", "การวิเคราะห์สถิติเชิงพรรณนาและสร้างกราฟ", "วิเคราะห์ค่าเฉลี่ย ส่วนเบี่ยงเบนมาตรฐาน พร้อมสร้างกราฟสรุปผล", 15, "2026-12-25 23:59", "open"],
      ["งาน-03", "รายงานการวิเคราะห์ข้อมูลด้วยตารางคำนวณ", "สรุปผลการวิเคราะห์ข้อมูลกรณีศึกษา ส่งไฟล์รายงานและไฟล์ข้อมูลประกอบ", 20, "2027-01-10 23:59", "open"]
    ];

    initialAssignments.forEach(function (item) {
      const subFolder = getOrCreateSubFolder_(rootFolder, item[0], "");
      assignmentsSheet.appendRow([
        item[0], item[1], item[2], item[3], item[4], item[5], subFolder.getId(), nowStr
      ]);
    });
  } else {
    // ตรวจสอบให้แน่ใจว่างานเดิมทุกชิ้นมีโฟลเดอร์ย่อยครบ
    syncAssignmentFolders_(assignmentsSheet, rootFolder);
  }

  // ลบชีตเปล่าเริ่มต้น (Sheet1 / แผ่นงาน1) หากยังมีอยู่และมีแท็บอื่นครบแล้ว
  ["Sheet1", "แผ่นงาน1"].forEach(function (defaultName) {
    const defSheet = ss.getSheetByName(defaultName);
    if (defSheet && ss.getSheets().length > 4 && defSheet.getLastRow() === 0) {
      ss.deleteSheet(defSheet);
    }
  });

  Logger.log("========================================");
  Logger.log("ติดตั้งระบบส่งงาน 09412315 สำเร็จเรียบร้อย!");
  Logger.log("Google Sheet: " + ss.getUrl());
  Logger.log("โฟลเดอร์หลัก Google Drive: " + rootFolder.getName());
  Logger.log("Root Folder ID: " + rootFolder.getId());
  Logger.log("Root Folder URL: " + rootFolder.getUrl());
  Logger.log("========================================");
}

function ensureSheet_(ss, name, headers, textColIndices) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  // จัดสไตล์แถวหัวตาราง
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange
    .setBackground("#0c2340")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  sheet.setFrozenRows(1);

  // ตั้งรูปแบบคอลัมน์เป็น Plain Text (@) ป้องกันการตัดเลข 0 นำหน้าหรือแปลงวันที่ผิดพลาด
  const maxRows = Math.max(sheet.getMaxRows(), 200);
  textColIndices.forEach(function (colIdx) {
    sheet.getRange(2, colIdx, maxRows - 1, 1).setNumberFormat("@");
  });

  for (let c = 1; c <= headers.length; c++) {
    sheet.autoResizeColumn(c);
  }
  return sheet;
}

function syncAssignmentFolders_(assignmentsSheet, rootFolder) {
  const lastRow = assignmentsSheet.getLastRow();
  if (lastRow < 2) return;
  const values = assignmentsSheet.getRange(2, 1, lastRow - 1, 8).getValues();
  for (let i = 0; i < values.length; i++) {
    const assignmentId = cleanStr_(values[i][0]);
    const folderId = cleanStr_(values[i][6]);
    if (!assignmentId) continue;
    const folder = getOrCreateSubFolder_(rootFolder, assignmentId, folderId);
    if (folder.getId() !== folderId) {
      assignmentsSheet.getRange(i + 2, 7).setValue(folder.getId());
    }
  }
}

// ==================== 2. Web App Entry Points (GET / POST) ====================

function doGet() {
  return jsonResponse_({
    ok: true,
    service: "09412315 Student Assignment Submission API",
    course: "09412315 คอมพิวเตอร์และการวิเคราะห์ข้อมูล (Computer and Data Analysis)",
    semester: "2/2569",
    instructor: "ผศ.ดร.ศราวุธ ใจเย็น",
    timestamp: formatNow_()
  });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ ok: false, error: "ไม่พบข้อมูลคำขอ (Empty request body)" });
    }

    const req = JSON.parse(e.postData.contents);
    const action = cleanStr_(req.action);

    switch (action) {
      case "login":
        return jsonResponse_(handleLogin_(req));

      case "getStudentDashboard":
        return jsonResponse_(handleGetStudentDashboard_(req));

      case "submitWork":
        return jsonResponse_(handleSubmitWork_(req));

      case "getTeacherDashboard":
        return jsonResponse_(handleGetTeacherDashboard_(req));

      case "gradeSubmission":
        return jsonResponse_(handleGradeSubmission_(req));

      case "saveAssignment":
        return jsonResponse_(handleSaveAssignment_(req));

      case "toggleAssignmentStatus":
        return jsonResponse_(handleToggleAssignmentStatus_(req));

      default:
        return jsonResponse_({ ok: false, error: "ไม่รู้จักคำสั่ง action: " + action });
    }
  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==================== 3. Authentication & Token Helpers ====================

function handleLogin_(req) {
  const role = cleanStr_(req.role);
  const username = cleanStr_(req.username);
  const password = String(req.password == null ? "" : req.password);

  if (!username || !password) {
    return { ok: false, error: "กรุณากรอก Username และ Password ให้ครบถ้วน" };
  }

  const ss = getSpreadsheet_();

  if (role === "student") {
    const students = readStudents_(ss);
    const found = students.find(function (s) {
      return s.username === username && s.password === password;
    });
    if (!found) {
      return { ok: false, error: "Username หรือ Password ของนักศึกษาไม่ถูกต้อง" };
    }

    const token = createToken_({
      role: "student",
      student_id: found.student_id,
      full_name: found.full_name,
      username: found.username
    });

    return {
      ok: true,
      token: token,
      user: {
        role: "student",
        student_id: found.student_id,
        full_name: found.full_name,
        username: found.username
      }
    };
  }

  if (role === "teacher") {
    const teachers = readTeachers_(ss);
    const found = teachers.find(function (t) {
      return t.username === username && t.password === password;
    });
    if (!found) {
      return { ok: false, error: "Username หรือ Password ของอาจารย์ไม่ถูกต้อง" };
    }

    const token = createToken_({
      role: "teacher",
      teacher_name: found.teacher_name,
      username: found.username
    });

    return {
      ok: true,
      token: token,
      user: {
        role: "teacher",
        teacher_name: found.teacher_name,
        username: found.username
      }
    };
  }

  return { ok: false, error: "ประเภทผู้ใช้งานไม่ถูกต้อง (ต้องเป็น student หรือ teacher)" };
}

function getAuthSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty("AUTH_SECRET");
  if (!secret) {
    secret = Utilities.getUuid() + "-" + Utilities.getUuid();
    props.setProperty("AUTH_SECRET", secret);
  }
  return secret;
}

function createToken_(payloadObj) {
  const data = Object.assign({}, payloadObj, {
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS
  });
  const encodedPayload = Utilities.base64EncodeWebSafe(JSON.stringify(data));
  const sigBytes = Utilities.computeHmacSha256Signature(encodedPayload, getAuthSecret_());
  const encodedSig = Utilities.base64EncodeWebSafe(sigBytes);
  return encodedPayload + "." + encodedSig;
}

function verifyToken_(token, expectedRole) {
  if (!token || typeof token !== "string" || token.indexOf(".") === -1) {
    throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง");
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new Error("Token ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่");
  }
  const encodedPayload = parts[0];
  const encodedSig = parts[1];

  const expectedSigBytes = Utilities.computeHmacSha256Signature(encodedPayload, getAuthSecret_());
  const expectedSig = Utilities.base64EncodeWebSafe(expectedSigBytes);

  if (encodedSig !== expectedSig) {
    throw new Error("ไม่สามารถยืนยันตัวตนได้ กรุณาเข้าสู่ระบบใหม่");
  }

  const decodedBytes = Utilities.base64DecodeWebSafe(encodedPayload);
  const payload = JSON.parse(Utilities.newBlob(decodedBytes).getDataAsString("UTF-8"));

  if (!payload.exp || Date.now() > payload.exp) {
    throw new Error("เซสชันหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่อีกครั้ง");
  }
  if (expectedRole && payload.role !== expectedRole) {
    throw new Error("คุณไม่มีสิทธิ์เข้าถึงส่วนนี้");
  }
  return payload;
}

// ==================== 4. Student Endpoints ====================

function handleGetStudentDashboard_(req) {
  const auth = verifyToken_(req.token, "student");
  const ss = getSpreadsheet_();

  const students = readStudents_(ss);
  const student = students.find(function (s) {
    return s.student_id === auth.student_id;
  }) || {
    student_id: auth.student_id,
    full_name: auth.full_name,
    username: auth.username
  };

  const assignments = readAssignments_(ss);
  const allSubmissions = readSubmissions_(ss);
  const mySubmissions = allSubmissions.filter(function (sub) {
    return sub.student_id === student.student_id;
  });

  const subMap = {};
  mySubmissions.forEach(function (sub) {
    subMap[sub.assignment_id] = sub;
  });

  const items = assignments.map(function (asg) {
    const sub = subMap[asg.assignment_id] || null;
    return {
      assignment_id: asg.assignment_id,
      title: asg.title,
      description: asg.description,
      max_score: asg.max_score,
      deadline: asg.deadline,
      status: asg.status,
      submission: sub ? {
        submission_id: sub.submission_id,
        file_name: sub.file_name,
        file_url: sub.file_url,
        submitted_at: sub.submitted_at,
        is_late: sub.is_late,
        status: sub.status,
        score: sub.score,
        feedback: sub.feedback,
        graded_at: sub.graded_at
      } : null
    };
  });

  return {
    ok: true,
    student: {
      student_id: student.student_id,
      full_name: student.full_name
    },
    assignments: items,
    server_time: formatNow_()
  };
}

function handleSubmitWork_(req) {
  const auth = verifyToken_(req.token, "student");
  const assignmentId = cleanStr_(req.assignment_id);
  const originalFileName = cleanStr_(req.original_file_name);
  const mimeType = cleanStr_(req.mime_type) || "application/octet-stream";
  const base64Data = String(req.file_base64 || "");

  if (!assignmentId) {
    return { ok: false, error: "กรุณาระบุรหัสงานที่ต้องการส่ง" };
  }
  if (!originalFileName || !base64Data) {
    return { ok: false, error: "กรุณาเลือกไฟล์งานก่อนกดส่ง" };
  }

  // ตรวจสอบนามสกุลไฟล์
  const ext = getExtension_(originalFileName);
  if (!ext || ALLOWED_EXTENSIONS.indexOf(ext) === -1) {
    return {
      ok: false,
      error: "ไม่รองรับไฟล์นามสกุล ." + (ext || "(ไม่มีนามสกุล)") + " (รองรับ: " + ALLOWED_EXTENSIONS.join(", ") + ")"
    };
  }

  // แปลง Base64 เป็น Blob และตรวจขนาดไม่เกิน 20 MB
  const bytes = Utilities.base64Decode(base64Data);
  if (bytes.length > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: "ไฟล์มีขนาดเกิน 20 MB กรุณาย่อขนาดไฟล์แล้วส่งใหม่อีกครั้ง" };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = getSpreadsheet_();
    const assignmentsSheet = ss.getSheetByName(SHEETS.ASSIGNMENTS);
    const submissionsSheet = ss.getSheetByName(SHEETS.SUBMISSIONS);
    const students = readStudents_(ss);

    const student = students.find(function (s) {
      return s.student_id === auth.student_id;
    }) || {
      student_id: auth.student_id,
      full_name: auth.full_name
    };

    const assignments = readAssignments_(ss);
    const asg = assignments.find(function (a) {
      return a.assignment_id === assignmentId;
    });

    if (!asg) {
      return { ok: false, error: "ไม่พบรายการงาน: " + assignmentId };
    }
    if (asg.status !== "open") {
      return { ok: false, error: "งาน " + assignmentId + " ปิดรับการส่งงานแล้ว" };
    }

    // ตรวจสอบว่าเคยส่งงานนี้มาก่อนหรือไม่
    const submissions = readSubmissions_(ss);
    const existing = submissions.find(function (sub) {
      return sub.assignment_id === assignmentId && sub.student_id === student.student_id;
    });

    if (existing && existing.status === "graded") {
      return {
        ok: false,
        error: "อาจารย์ได้ตรวจให้คะแนนงานนี้แล้ว ไม่สามารถส่งไฟล์แก้ไขทับได้"
      };
    }

    // เตรียมโฟลเดอร์ย่อยตามรหัสงาน (สร้างให้อัตโนมัติหากยังไม่มี)
    const rootFolder = getOrCreateRootFolder_();
    const targetFolder = getOrCreateSubFolder_(rootFolder, assignmentId, asg.folder_id);
    if (targetFolder.getId() !== asg.folder_id) {
      assignmentsSheet.getRange(asg.row_index, 7).setValue(targetFolder.getId());
    }

    // เปลี่ยนชื่อไฟล์เป็นรูปแบบ: งาน-01_นายจารุกิตติ์_สมัน.pdf
    const renamedFileName = buildSubmissionFileName_(assignmentId, student.full_name, originalFileName);

    // หากเป็นการส่งแก้ไขทับไฟล์เดิม -> ย้ายไฟล์เก่าลงถังขยะ (Trash) อัตโนมัติ
    let trashedOldFile = false;
    if (existing && existing.file_id) {
      try {
        const oldFile = DriveApp.getFileById(existing.file_id);
        oldFile.setTrashed(true);
        trashedOldFile = true;
      } catch (trashErr) {
        // กรณีไฟล์เก่าถูกลบไปก่อนหน้าแล้ว ไม่ให้ขัดขวางการอัปโหลดใหม่
      }
    }

    // สร้างไฟล์ใหม่ในโฟลเดอร์งาน
    const blob = Utilities.newBlob(bytes, mimeType, renamedFileName);
    const createdFile = targetFolder.createFile(blob);

    if (SHARE_UPLOADED_FILE_BY_LINK) {
      try {
        createdFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (shareErr) {
        // ข้ามหากนโยบายโดเมนไม่อนุญาตให้แชร์สาธารณะ
      }
    }

    const nowDate = new Date();
    const submittedAt = formatDateTime_(nowDate);
    const isLate = isSubmissionLate_(nowDate, asg.deadline);
    const fileId = createdFile.getId();
    const fileUrl = createdFile.getUrl();

    let submissionId;
    if (existing) {
      submissionId = existing.submission_id;
      const updatedRow = [[
        submissionId,
        assignmentId,
        student.student_id,
        student.full_name,
        renamedFileName,
        fileId,
        fileUrl,
        submittedAt,
        isLate ? "TRUE" : "FALSE",
        "submitted",
        "",
        "",
        "",
        ""
      ]];
      submissionsSheet.getRange(existing.row_index, 1, 1, 14).setValues(updatedRow);
    } else {
      submissionId = "SUB-" + Utilities.formatDate(nowDate, TIMEZONE, "yyyyMMddHHmmss") + "-" + Math.floor(100 + Math.random() * 900);
      submissionsSheet.appendRow([
        submissionId,
        assignmentId,
        student.student_id,
        student.full_name,
        renamedFileName,
        fileId,
        fileUrl,
        submittedAt,
        isLate ? "TRUE" : "FALSE",
        "submitted",
        "",
        "",
        "",
        ""
      ]);
    }

    return {
      ok: true,
      message: existing
        ? "ส่งไฟล์แก้ไขสำเร็จ (ย้ายไฟล์เดิมลงถังขยะแล้ว)"
        : "ส่งงานสำเร็จเรียบร้อย",
      replaced: Boolean(existing),
      trashed_old_file: trashedOldFile,
      submission: {
        submission_id: submissionId,
        assignment_id: assignmentId,
        file_name: renamedFileName,
        file_url: fileUrl,
        submitted_at: submittedAt,
        is_late: isLate,
        status: "submitted",
        score: null,
        feedback: ""
      }
    };
  } finally {
    lock.releaseLock();
  }
}

// ==================== 5. Teacher Endpoints ====================

function handleGetTeacherDashboard_(req) {
  const auth = verifyToken_(req.token, "teacher");
  const ss = getSpreadsheet_();

  const students = readStudents_(ss).map(function (s) {
    return {
      student_id: s.student_id,
      full_name: s.full_name,
      username: s.username
    };
  });

  const assignments = readAssignments_(ss).map(function (a) {
    return {
      assignment_id: a.assignment_id,
      title: a.title,
      description: a.description,
      max_score: a.max_score,
      deadline: a.deadline,
      status: a.status,
      folder_id: a.folder_id,
      folder_url: a.folder_id ? ("https://drive.google.com/drive/folders/" + a.folder_id) : "",
      created_at: a.created_at
    };
  });

  const submissions = readSubmissions_(ss).map(function (sub) {
    return {
      submission_id: sub.submission_id,
      assignment_id: sub.assignment_id,
      student_id: sub.student_id,
      student_name: sub.student_name,
      file_name: sub.file_name,
      file_id: sub.file_id,
      file_url: sub.file_url,
      submitted_at: sub.submitted_at,
      is_late: sub.is_late,
      status: sub.status,
      score: sub.score,
      feedback: sub.feedback,
      graded_at: sub.graded_at,
      graded_by: sub.graded_by
    };
  });

  const rootFolder = getOrCreateRootFolder_();

  return {
    ok: true,
    teacher: {
      teacher_name: auth.teacher_name,
      username: auth.username
    },
    root_folder_url: rootFolder.getUrl(),
    students: students,
    assignments: assignments,
    submissions: submissions,
    server_time: formatNow_()
  };
}

function handleGradeSubmission_(req) {
  const auth = verifyToken_(req.token, "teacher");
  const assignmentId = cleanStr_(req.assignment_id);
  const studentId = cleanStr_(req.student_id);
  const rawScore = req.score;
  const feedback = String(req.feedback == null ? "" : req.feedback).trim();

  if (!assignmentId || !studentId) {
    return { ok: false, error: "ข้อมูลรหัสงานหรือรหัสนักศึกษาไม่ครบถ้วน" };
  }

  const scoreNum = Number(rawScore);
  if (rawScore === "" || rawScore === null || rawScore === undefined || isNaN(scoreNum)) {
    return { ok: false, error: "กรุณากรอกคะแนนเป็นตัวเลขที่ถูกต้อง" };
  }
  if (scoreNum < 0) {
    return { ok: false, error: "คะแนนต้องไม่ติดลบ" };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = getSpreadsheet_();
    const assignments = readAssignments_(ss);
    const asg = assignments.find(function (a) {
      return a.assignment_id === assignmentId;
    });
    if (!asg) {
      return { ok: false, error: "ไม่พบรายการงาน: " + assignmentId };
    }
    if (scoreNum > asg.max_score) {
      return {
        ok: false,
        error: "คะแนนต้องไม่เกินคะแนนเต็ม (" + asg.max_score + " คะแนน)"
      };
    }

    const submissionsSheet = ss.getSheetByName(SHEETS.SUBMISSIONS);
    const submissions = readSubmissions_(ss);
    const existing = submissions.find(function (sub) {
      return sub.assignment_id === assignmentId && sub.student_id === studentId;
    });

    if (!existing) {
      return { ok: false, error: "ไม่พบข้อมูลการส่งงานของนักศึกษาคนนี้" };
    }

    const gradedAt = formatNow_();
    const gradedBy = auth.teacher_name || auth.username;

    // อัปเดตคอลัมน์ status(10), score(11), feedback(12), graded_at(13), graded_by(14)
    submissionsSheet.getRange(existing.row_index, 10, 1, 5).setValues([[
      "graded",
      scoreNum,
      feedback,
      gradedAt,
      gradedBy
    ]]);

    return {
      ok: true,
      message: "บันทึกคะแนนเรียบร้อยแล้ว",
      graded: {
        assignment_id: assignmentId,
        student_id: studentId,
        status: "graded",
        score: scoreNum,
        feedback: feedback,
        graded_at: gradedAt,
        graded_by: gradedBy
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function handleSaveAssignment_(req) {
  verifyToken_(req.token, "teacher");

  const mode = cleanStr_(req.mode) || "create"; // "create" | "edit"
  const assignmentId = cleanStr_(req.assignment_id);
  const title = cleanStr_(req.title);
  const description = String(req.description == null ? "" : req.description).trim();
  const maxScore = Number(req.max_score);
  const deadline = normalizeDeadlineInput_(req.deadline);
  const status = cleanStr_(req.status) === "closed" ? "closed" : "open";

  if (!assignmentId) {
    return { ok: false, error: "กรุณาระบุรหัสงาน (เช่น งาน-04)" };
  }
  if (!title) {
    return { ok: false, error: "กรุณาระบุหัวข้องาน" };
  }
  if (isNaN(maxScore) || maxScore <= 0) {
    return { ok: false, error: "กรุณาระบุคะแนนเต็มเป็นตัวเลขมากกว่า 0" };
  }
  if (!deadline) {
    return { ok: false, error: "กรุณาระบุวัน-เวลาครบกำหนดส่ง (Deadline)" };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = getSpreadsheet_();
    const assignmentsSheet = ss.getSheetByName(SHEETS.ASSIGNMENTS);
    const assignments = readAssignments_(ss);
    const existing = assignments.find(function (a) {
      return a.assignment_id === assignmentId;
    });

    const rootFolder = getOrCreateRootFolder_();

    if (mode === "edit") {
      if (!existing) {
        return { ok: false, error: "ไม่พบงานรหัส " + assignmentId + " ที่ต้องการแก้ไข" };
      }
      const folder = getOrCreateSubFolder_(rootFolder, assignmentId, existing.folder_id);
      assignmentsSheet.getRange(existing.row_index, 2, 1, 6).setValues([[
        title,
        description,
        maxScore,
        deadline,
        status,
        folder.getId()
      ]]);

      return {
        ok: true,
        message: "แก้ไขรายละเอียดงาน " + assignmentId + " เรียบร้อยแล้ว",
        assignment: {
          assignment_id: assignmentId,
          title: title,
          description: description,
          max_score: maxScore,
          deadline: deadline,
          status: status,
          folder_id: folder.getId(),
          folder_url: folder.getUrl()
        }
      };
    }

    // สร้างงานใหม่
    if (existing) {
      return { ok: false, error: "รหัสงาน \"" + assignmentId + "\" มีอยู่แล้วในระบบ กรุณาใช้รหัสอื่น" };
    }

    const folder = getOrCreateSubFolder_(rootFolder, assignmentId, "");
    const createdAt = formatNow_();

    assignmentsSheet.appendRow([
      assignmentId,
      title,
      description,
      maxScore,
      deadline,
      status,
      folder.getId(),
      createdAt
    ]);

    return {
      ok: true,
      message: "เพิ่มงาน " + assignmentId + " และสร้างโฟลเดอร์ใน Google Drive เรียบร้อยแล้ว",
      assignment: {
        assignment_id: assignmentId,
        title: title,
        description: description,
        max_score: maxScore,
        deadline: deadline,
        status: status,
        folder_id: folder.getId(),
        folder_url: folder.getUrl(),
        created_at: createdAt
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function handleToggleAssignmentStatus_(req) {
  verifyToken_(req.token, "teacher");
  const assignmentId = cleanStr_(req.assignment_id);
  const newStatus = cleanStr_(req.status) === "closed" ? "closed" : "open";

  if (!assignmentId) {
    return { ok: false, error: "กรุณาระบุรหัสงาน" };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = getSpreadsheet_();
    const assignmentsSheet = ss.getSheetByName(SHEETS.ASSIGNMENTS);
    const assignments = readAssignments_(ss);
    const existing = assignments.find(function (a) {
      return a.assignment_id === assignmentId;
    });

    if (!existing) {
      return { ok: false, error: "ไม่พบงานรหัส " + assignmentId };
    }

    assignmentsSheet.getRange(existing.row_index, 6).setValue(newStatus);

    return {
      ok: true,
      message: newStatus === "open"
        ? "เปิดรับส่งงาน " + assignmentId + " แล้ว"
        : "ปิดรับส่งงาน " + assignmentId + " แล้ว",
      assignment_id: assignmentId,
      status: newStatus
    };
  } finally {
    lock.releaseLock();
  }
}

// ==================== 6. Sheet Readers ====================

function getSpreadsheet_() {
  if (SPREADSHEET_ID && SPREADSHEET_ID.trim() !== "") {
    return SpreadsheetApp.openById(SPREADSHEET_ID.trim());
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error("ไม่พบ Google Sheet กรุณาผูกสคริปต์กับไฟล์ Google Sheet หรือระบุ SPREADSHEET_ID");
  }
  return active;
}

function readStudents_(ss) {
  const sheet = ss.getSheetByName(SHEETS.STUDENTS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  const list = [];
  for (let i = 0; i < rows.length; i++) {
    const studentId = cleanStr_(rows[i][0]);
    const fullName = cleanStr_(rows[i][1]);
    const username = cleanStr_(rows[i][2]);
    const password = String(rows[i][3] == null ? "" : rows[i][3]).trim();
    if (!studentId && !username) continue;
    list.push({
      row_index: i + 2,
      student_id: studentId,
      full_name: fullName,
      username: username,
      password: password
    });
  }
  return list;
}

function readTeachers_(ss) {
  const sheet = ss.getSheetByName(SHEETS.TEACHERS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  const list = [];
  for (let i = 0; i < rows.length; i++) {
    const teacherName = cleanStr_(rows[i][0]);
    const username = cleanStr_(rows[i][1]);
    const password = String(rows[i][2] == null ? "" : rows[i][2]).trim();
    if (!username) continue;
    list.push({
      row_index: i + 2,
      teacher_name: teacherName || "อาจารย์ผู้สอน",
      username: username,
      password: password
    });
  }
  return list;
}

function readAssignments_(ss) {
  const sheet = ss.getSheetByName(SHEETS.ASSIGNMENTS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  const list = [];
  for (let i = 0; i < rows.length; i++) {
    const assignmentId = cleanStr_(rows[i][0]);
    if (!assignmentId) continue;
    list.push({
      row_index: i + 2,
      assignment_id: assignmentId,
      title: cleanStr_(rows[i][1]),
      description: cleanStr_(rows[i][2]),
      max_score: Number(rows[i][3]) || 0,
      deadline: formatCellDateTime_(rows[i][4], false),
      status: cleanStr_(rows[i][5]).toLowerCase() === "closed" ? "closed" : "open",
      folder_id: cleanStr_(rows[i][6]),
      created_at: formatCellDateTime_(rows[i][7], true)
    });
  }
  return list;
}

function readSubmissions_(ss) {
  const sheet = ss.getSheetByName(SHEETS.SUBMISSIONS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 14).getValues();
  const list = [];
  for (let i = 0; i < rows.length; i++) {
    const assignmentId = cleanStr_(rows[i][1]);
    const studentId = cleanStr_(rows[i][2]);
    if (!assignmentId || !studentId) continue;

    const rawScore = rows[i][10];
    const score = (rawScore === "" || rawScore === null || rawScore === undefined)
      ? null
      : Number(rawScore);

    const rawLate = rows[i][8];
    const isLate = rawLate === true || String(rawLate).toUpperCase() === "TRUE";

    list.push({
      row_index: i + 2,
      submission_id: cleanStr_(rows[i][0]),
      assignment_id: assignmentId,
      student_id: studentId,
      student_name: cleanStr_(rows[i][3]),
      file_name: cleanStr_(rows[i][4]),
      file_id: cleanStr_(rows[i][5]),
      file_url: cleanStr_(rows[i][6]),
      submitted_at: formatCellDateTime_(rows[i][7], true),
      is_late: isLate,
      status: cleanStr_(rows[i][9]).toLowerCase() === "graded" ? "graded" : "submitted",
      score: isNaN(score) ? null : score,
      feedback: cleanStr_(rows[i][11]),
      graded_at: formatCellDateTime_(rows[i][12], true),
      graded_by: cleanStr_(rows[i][13])
    });
  }
  return list;
}

// ==================== 7. Google Drive Folder & File Helpers ====================

function getOrCreateRootFolder_() {
  // 1) ใช้ค่าจากตัวแปร ROOT_FOLDER_ID หากกำหนดไว้
  if (ROOT_FOLDER_ID && ROOT_FOLDER_ID.trim() !== "") {
    return DriveApp.getFolderById(ROOT_FOLDER_ID.trim());
  }

  // 2) ใช้ค่าที่บันทึกไว้ใน Script Properties
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty("AUTO_ROOT_FOLDER_ID");
  if (savedId) {
    try {
      const folder = DriveApp.getFolderById(savedId);
      if (!folder.isTrashed()) return folder;
    } catch (e) {
      // สร้างใหม่หากโฟลเดอร์เดิมถูกลบ
    }
  }

  // 3) สร้างโฟลเดอร์หลักใหม่บน Google Drive อัตโนมัติ
  const folderName = "09412315_ระบบส่งงาน_2-2569";
  const existingIter = DriveApp.getFoldersByName(folderName);
  let rootFolder;
  if (existingIter.hasNext()) {
    rootFolder = existingIter.next();
  } else {
    rootFolder = DriveApp.createFolder(folderName);
  }
  props.setProperty("AUTO_ROOT_FOLDER_ID", rootFolder.getId());
  return rootFolder;
}

function getOrCreateSubFolder_(rootFolder, assignmentId, existingFolderId) {
  if (existingFolderId) {
    try {
      const f = DriveApp.getFolderById(existingFolderId);
      if (!f.isTrashed()) return f;
    } catch (e) {
      // โฟลเดอร์เดิมอาจถูกลบ ให้ค้นหาหรือสร้างใหม่
    }
  }

  const iter = rootFolder.getFoldersByName(assignmentId);
  while (iter.hasNext()) {
    const f = iter.next();
    if (!f.isTrashed()) return f;
  }

  return rootFolder.createFolder(assignmentId);
}

function buildSubmissionFileName_(assignmentId, fullName, originalFileName) {
  const ext = getExtension_(originalFileName);
  const cleanAsg = cleanStr_(assignmentId).replace(/[\/\\:*?"<>|]+/g, "-");
  const cleanName = cleanStr_(fullName)
    .replace(/\s+/g, "_")
    .replace(/[\/\\:*?"<>|]+/g, "");
  return cleanAsg + "_" + cleanName + (ext ? "." + ext : "");
}

function getExtension_(fileName) {
  const name = cleanStr_(fileName);
  const idx = name.lastIndexOf(".");
  if (idx === -1 || idx === name.length - 1) return "";
  return name.slice(idx + 1).toLowerCase();
}

// ==================== 8. Date & String Utilities ====================

function cleanStr_(val) {
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function formatNow_() {
  return formatDateTime_(new Date());
}

function formatDateTime_(dateObj) {
  return Utilities.formatDate(dateObj, TIMEZONE, "yyyy-MM-dd HH:mm:ss");
}

function formatCellDateTime_(val, includeSeconds) {
  if (val === null || val === undefined || val === "") return "";
  if (val instanceof Date) {
    return Utilities.formatDate(
      val,
      TIMEZONE,
      includeSeconds ? "yyyy-MM-dd HH:mm:ss" : "yyyy-MM-dd HH:mm"
    );
  }
  return cleanStr_(val).replace("T", " ");
}

function normalizeDeadlineInput_(val) {
  const s = cleanStr_(val);
  if (!s) return "";
  return s.replace("T", " ").slice(0, 16);
}

function isSubmissionLate_(nowDate, deadlineStr) {
  if (!deadlineStr) return false;
  // แปลง "YYYY-MM-DD HH:mm" เป็นเวลาโซนไทย (+07:00)
  const normalized = deadlineStr.replace(" ", "T");
  const withSeconds = normalized.length === 16 ? normalized + ":59" : normalized;
  const isoStr = withSeconds.indexOf("+") === -1 && withSeconds.indexOf("Z") === -1
    ? withSeconds + "+07:00"
    : withSeconds;
  const deadlineDate = new Date(isoStr);
  if (isNaN(deadlineDate.getTime())) return false;
  return nowDate.getTime() > deadlineDate.getTime();
}
