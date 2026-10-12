const express = require('express');
const DataService = require('../services/dataService');
const CalculatorService = require('../services/calculatorService');
const { CalendarService, validDate, isExcluded } = require('../services/calendarService');
const AccountService = require('../services/accountService');
const { clerkClient } = require('@clerk/express');

const router = express.Router();
const VALID_ATTENDANCE_STATUSES = new Set(['present', 'absent', 'extra']);
const VALID_TIMETABLE_DAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

function isValidTime(value) {
    return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidDateString(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function getRequestUserId(req) {
    if (typeof req.auth === 'function') {
        const auth = req.auth();
        return auth && auth.userId;
    }
    return req.auth && req.auth.userId;
}

function validateTimetablePayload({ subjectId, day, startTime, endTime }) {
    if (!subjectId || !day || !startTime || !endTime) {
        return 'subjectId, day, startTime, endTime are required';
    }
    if (!VALID_TIMETABLE_DAYS.has(String(day).toLowerCase())) {
        return 'Invalid timetable day';
    }
    if (!isValidTime(startTime) || !isValidTime(endTime)) {
        return 'Times must use HH:MM format';
    }
    if (startTime >= endTime) {
        return 'endTime must be after startTime';
    }
    return null;
}

function requireAuth(req, res, next) {
    const userId = getRequestUserId(req);
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    req.userId = userId;
    next();
}

// GET all subjects with analysis
router.get('/subjects', requireAuth, async (req, res) => {
    try {
        const [subjects, profile] = await Promise.all([
            DataService.getSubjects(req.userId),
            DataService.getProfile(req.userId)
        ]);
        const requirement = Number.isFinite(Number.parseFloat(profile && profile.attendance_requirement_percentage))
            ? Number.parseFloat(profile.attendance_requirement_percentage)
            : 75.0;
        const analyzed = subjects.map(s => CalculatorService.analyzeSubject(s, requirement));
        res.json(analyzed);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET user profile
router.get('/profile', requireAuth, async (req, res) => {
    try {
        const profile = await DataService.getProfile(req.userId);
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// UPDATE user profile
router.put('/profile', requireAuth, async (req, res) => {
    try {
        const { name, college, semester, attendance_requirement_percentage } = req.body;

        const profileUpdates = {};
        if (name !== undefined) profileUpdates.name = name;
        if (college !== undefined) profileUpdates.college = college;
        if (semester !== undefined) profileUpdates.semester = semester;

        if (attendance_requirement_percentage !== undefined) {
            const parsedRequirement = Number.parseFloat(attendance_requirement_percentage);
            if (!Number.isFinite(parsedRequirement)) {
                return res.status(400).json({ error: 'Invalid attendance requirement percentage' });
            }
            profileUpdates.attendance_requirement_percentage = parsedRequirement;
        }

        await DataService.updateProfile(req.userId, profileUpdates);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET single subject with stats and history
router.get('/subjects/:id', requireAuth, async (req, res) => {
    try {
        const [subject, profile] = await Promise.all([
            DataService.getSubjectById(req.userId, req.params.id),
            DataService.getProfile(req.userId)
        ]);
        if (!subject) return res.status(404).json({ error: 'Subject not found' });
        const requirement = Number.isFinite(Number.parseFloat(profile && profile.attendance_requirement_percentage))
            ? Number.parseFloat(profile.attendance_requirement_percentage)
            : 75.0;
        const analyzed = CalculatorService.analyzeSubject(subject, requirement);
        res.json({ subject: analyzed, history: subject.history });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST new subject
router.post('/subjects', requireAuth, async (req, res) => {
    try {
        const subjectName = typeof req.body.subject_name === 'string' ? req.body.subject_name.trim() : '';
        if (!subjectName) {
            return res.status(400).json({ error: 'Subject name is required' });
        }
        if (req.body.min_requirement_percentage !== undefined) {
            const parsedRequirement = Number.parseFloat(req.body.min_requirement_percentage);
            if (!Number.isFinite(parsedRequirement)) {
                return res.status(400).json({ error: 'Invalid required percentage' });
            }
        }
        const newSubject = await DataService.createSubject(req.userId, {
            ...req.body,
            subject_name: subjectName,
            faculty_name: typeof req.body.faculty_name === 'string' ? req.body.faculty_name.trim() : ''
        });
        res.status(201).json({ id: newSubject.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT update subject
router.put('/subjects/:id', requireAuth, async (req, res) => {
    try {
        const data = await DataService.getUserData(req.userId);
        const subjectIndex = data.subjects.findIndex(s => s.id === req.params.id);
        if (subjectIndex === -1) return res.status(404).json({ error: 'Subject not found' });

        const updatedFields = req.body;
        if (updatedFields.subject_name !== undefined) data.subjects[subjectIndex].subject_name = updatedFields.subject_name;
        if (updatedFields.faculty_name !== undefined) data.subjects[subjectIndex].faculty_name = updatedFields.faculty_name;
        if (updatedFields.min_requirement_percentage !== undefined) {
            const parsedRequirement = Number.parseFloat(updatedFields.min_requirement_percentage);
            if (!Number.isFinite(parsedRequirement)) {
                return res.status(400).json({ error: 'Invalid required percentage' });
            }
            data.subjects[subjectIndex].min_requirement_percentage = Math.min(100, Math.max(0, parsedRequirement));
        }

        await DataService.saveUserData(req.userId, data);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE subject
router.delete('/subjects/:id', requireAuth, async (req, res) => {
    try {
        await DataService.deleteSubject(req.userId, req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST mark attendance
router.post('/attendance/mark', requireAuth, async (req, res) => {
    try {
        const { subjectId, status, date } = req.body;
        if (!subjectId) {
            return res.status(400).json({ error: 'subjectId is required' });
        }
        if (!VALID_ATTENDANCE_STATUSES.has(status)) {
            return res.status(400).json({ error: 'Invalid attendance status' });
        }
        if (!isValidDateString(date)) {
            return res.status(400).json({ error: 'Invalid attendance date' });
        }
        if (req.body.source === 'auto' && !(await AccountService.getPreferences(req.userId)).autoAttendance) {
            return res.status(409).json({ error: 'Location-assisted attendance is disabled for this account.' });
        }
        const calendar = await CalendarService.get(req.userId);
        if (status !== 'extra' && isExcluded(calendar, date, subjectId)) {
            return res.status(409).json({ error: 'This date is a holiday or these classes are cancelled. Regular attendance is not counted; use Extra for a class that actually took place.' });
        }
        await DataService.markAttendance(req.userId, subjectId, status, date);
        res.json({ success: true });
    } catch (err) {
        if (err.message === 'Subject not found') {
            return res.status(404).json({ error: err.message });
        }
        res.status(500).json({ error: err.message });
    }
});

// DELETE attendance record
router.delete('/attendance/:subjectId/:recordId', requireAuth, async (req, res) => {
    try {
        const success = await DataService.deleteAttendanceRecord(req.userId, req.params.subjectId, req.params.recordId);
        if (!success) return res.status(404).json({ error: 'Record or subject not found' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET Dashboard data
router.get('/dashboard', requireAuth, async (req, res) => {
    try {
        const [subjects, profile] = await Promise.all([
            DataService.getSubjects(req.userId),
            DataService.getProfile(req.userId)
        ]);

        let totalAttended = 0;
        let totalClassesAll = 0;

        const requirement = Number.isFinite(Number.parseFloat(profile && profile.attendance_requirement_percentage))
            ? Number.parseFloat(profile.attendance_requirement_percentage)
            : 75.0;

        const analyzedSubjects = subjects.map(s => {
            totalAttended += s.attended_classes;
            totalClassesAll += s.total_classes;
            return CalculatorService.analyzeSubject(s, requirement);
        });

        const currentPercentage = CalculatorService.calculateAttendancePercentage(totalAttended, totalClassesAll);

        let overallStatus = 'safe';
        if (currentPercentage < requirement) overallStatus = 'danger';
        else if (currentPercentage - requirement <= 2) overallStatus = 'warning';

        res.json({
            profile,
            overall_percentage: currentPercentage,
            total_attended: totalAttended,
            total_classes: totalClassesAll,
            overall_status: overallStatus,
            subjects: analyzedSubjects
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analytics/trend
router.get('/analytics/trend', requireAuth, async (req, res) => {
    try {
        const subjects = await DataService.getSubjects(req.userId);
        const limitDate = new Date();
        limitDate.setDate(limitDate.getDate() - 30);
        let dailyStats = {};

        subjects.forEach(sub => {
            if (sub.history) {
                sub.history.forEach(record => {
                    const d = new Date(record.date);
                    if (d >= limitDate) {
                        const dateStr = record.date.substring(0, 10);
                        if (!dailyStats[dateStr]) dailyStats[dateStr] = { present: 0, absent: 0, total: 0 };
                        if (record.status === 'present' || record.status === 'extra') {
                            dailyStats[dateStr].present++;
                            dailyStats[dateStr].total++;
                        } else if (record.status === 'absent') {
                            dailyStats[dateStr].absent++;
                            dailyStats[dateStr].total++;
                        }
                    }
                });
            }
        });

        const sortedDates = Object.keys(dailyStats).sort();
        res.json(sortedDates.map(date => ({
            date,
            present: dailyStats[date].present,
            absent: dailyStats[date].absent,
            total: dailyStats[date].total
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/export
router.get('/export', requireAuth, async (req, res) => {
    try {
        const [userData, calendar, settings] = await Promise.all([DataService.getUserData(req.userId), CalendarService.get(req.userId), AccountService.getPreferences(req.userId)]);
        res.setHeader('Content-disposition', `attachment; filename=attendify_backup_${req.userId}.json`);
        res.setHeader('Content-type', 'application/json');
        res.send(JSON.stringify({ ...userData, calendar, settings }, null, 2));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/import
router.post('/import', requireAuth, async (req, res) => {
    try {
        const incomingData = req.body;
        if (!incomingData || !incomingData.profile || !Array.isArray(incomingData.subjects)) {
            return res.status(400).json({ error: 'Invalid file format. Ensure it is a valid Attendify export.' });
        }
        const { calendar, settings, ...attendance } = incomingData;
        if (calendar !== undefined && (!calendar || !Array.isArray(calendar.holidays) || !Array.isArray(calendar.cancellations) || calendar.holidays.some(date => !validDate(date)) || calendar.cancellations.some(item => !item || !validDate(item.date) || typeof item.subjectId !== 'string' || !attendance.subjects.some(subject => subject.id === item.subjectId)))) {
            return res.status(400).json({ error: 'Invalid holiday or cancelled-class backup data' });
        }
        if (settings !== undefined && (!settings || ['autoAttendance', 'reminders'].some(key => typeof settings[key] !== 'boolean'))) {
            return res.status(400).json({ error: 'Invalid privacy preferences in backup' });
        }
        await DataService.saveUserData(req.userId, attendance);
        if (calendar !== undefined) await CalendarService.save(req.userId, calendar);
        if (settings !== undefined) await AccountService.setPreferences(req.userId, { autoAttendance: settings.autoAttendance, reminders: settings.reminders });
        res.json({ success: true, message: 'Data imported successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── TIMETABLE ───────────────────────────────────────────

// GET timetable (enriched with subject names)
router.get('/timetable', requireAuth, async (req, res) => {
    try {
        const [timetable, subjects] = await Promise.all([
            DataService.getTimetable(req.userId),
            DataService.getSubjects(req.userId)
        ]);
        const subjectMap = {};
        subjects.forEach(s => { subjectMap[s.id] = s.subject_name; });
        const enriched = timetable.map(slot => ({
            ...slot,
            subject_name: subjectMap[slot.subjectId] || 'Unknown'
        }));
        res.json(enriched);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST add timetable slot
router.post('/timetable', requireAuth, async (req, res) => {
    try {
        const { subjectId, day, startTime, endTime } = req.body;
        const validationError = validateTimetablePayload({ subjectId, day, startTime, endTime });
        if (validationError) {
            return res.status(400).json({ error: validationError });
        }
        const subject = await DataService.getSubjectById(req.userId, subjectId);
        if (!subject) {
            return res.status(404).json({ error: 'Subject not found' });
        }
        const slot = await DataService.addTimetableSlot(req.userId, {
            subjectId,
            day: String(day).toLowerCase(),
            startTime,
            endTime
        });
        res.status(201).json(slot);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT update timetable slot
router.put('/timetable/:id', requireAuth, async (req, res) => {
    try {
        const { subjectId, day, startTime, endTime } = req.body;
        const validationError = validateTimetablePayload({ subjectId, day, startTime, endTime });
        if (validationError) {
            return res.status(400).json({ error: validationError });
        }
        const subject = await DataService.getSubjectById(req.userId, subjectId);
        if (!subject) {
            return res.status(404).json({ error: 'Subject not found' });
        }
        const slot = await DataService.updateTimetableSlot(req.userId, req.params.id, {
            subjectId,
            day: String(day).toLowerCase(),
            startTime,
            endTime
        });
        if (!slot) return res.status(404).json({ error: 'Timetable slot not found' });
        res.json(slot);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE timetable slot
router.delete('/timetable/:id', requireAuth, async (req, res) => {
    try {
        await DataService.deleteTimetableSlot(req.userId, req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── COLLEGE LOCATION ────────────────────────────────────

// GET college location
router.get('/settings/location', requireAuth, async (req, res) => {
    try {
        const loc = await DataService.getCollegeLocation(req.userId);
        res.json(loc || { lat: null, lng: null, radius: 150 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT save college location
router.put('/settings/location', requireAuth, async (req, res) => {
    try {
        const { lat, lng, radius } = req.body;
        const parsedLat = Number.parseFloat(lat);
        const parsedLng = Number.parseFloat(lng);
        const parsedRadius = Number.parseInt(radius, 10);
        if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
            return res.status(400).json({ error: 'Valid lat and lng are required' });
        }
        if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
            return res.status(400).json({ error: 'lat or lng is out of range' });
        }
        if (radius !== undefined && (!Number.isFinite(parsedRadius) || parsedRadius <= 0)) {
            return res.status(400).json({ error: 'radius must be a positive number' });
        }
        const saved = await DataService.saveCollegeLocation(req.userId, {
            lat: parsedLat,
            lng: parsedLng,
            radius: parsedRadius || 150
        });
        res.json(saved);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Calendar exceptions belong to the authenticated account, independently of attendance.
router.get('/calendar/exceptions', requireAuth, async (req, res, next) => {
    try { res.json(await CalendarService.get(req.userId)); } catch (err) { next(err); }
});
router.put('/calendar/holidays/:date', requireAuth, async (req, res, next) => {
    if (!validDate(req.params.date) || typeof req.body.enabled !== 'boolean') return res.status(400).json({ error: 'A valid date and enabled boolean are required' });
    try { res.json(await CalendarService.holiday(req.userId, req.params.date, req.body.enabled)); } catch (err) { next(err); }
});
router.put('/calendar/cancellations', requireAuth, async (req, res, next) => {
    const { date, subjectId, enabled } = req.body;
    if (!validDate(date) || typeof subjectId !== 'string' || typeof enabled !== 'boolean') return res.status(400).json({ error: 'A valid date, subjectId and enabled boolean are required' });
    try {
        if (!(await DataService.getSubjectById(req.userId, subjectId))) return res.status(404).json({ error: 'Subject not found' });
        res.json(await CalendarService.cancel(req.userId, date, subjectId, enabled));
    } catch (err) { next(err); }
});
router.get('/settings/preferences', requireAuth, async (req, res, next) => {
    try { res.json(await AccountService.getPreferences(req.userId)); } catch (err) { next(err); }
});
router.put('/settings/preferences', requireAuth, async (req, res, next) => {
    const settings = {};
    for (const key of ['autoAttendance', 'reminders']) {
        if (req.body[key] !== undefined) {
            if (typeof req.body[key] !== 'boolean') return res.status(400).json({ error: 'Preferences must be booleans' });
            settings[key] = req.body[key];
        }
    }
    if (!Object.keys(settings).length) return res.status(400).json({ error: 'No preferences supplied' });
    try { res.json(await AccountService.setPreferences(req.userId, settings)); } catch (err) { next(err); }
});
// Cookie-authenticated destructive actions must originate from this application.
function sameOrigin(req, res, next) {
    const origin = req.get('origin');
    const expected = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    if (!origin || origin !== expected) return res.status(403).json({ error: 'Use the account controls from this application.' });
    next();
}
async function recentVerification(req, res, next) {
    const auth = typeof req.auth === 'function' ? req.auth() : req.auth;
    const fva = auth.sessionClaims?.fva;
    let fresh = Array.isArray(fva) && fva.length === 2 && Number.isFinite(fva[0]) && fva[0] >= 0 && fva[0] < 10 && (fva[1] === -1 || (Number.isFinite(fva[1]) && fva[1] >= 0 && fva[1] < 10));
    // Legacy Clerk tokens lack fva; only a newly created session qualifies.
    if (!Array.isArray(fva) && auth.sessionId) {
        try {
            const session = await clerkClient.sessions.getSession(auth.sessionId);
            const age = Date.now() - Number(session.createdAt);
            fresh = session.userId === req.userId && age >= 0 && age < 10 * 60 * 1000;
        } catch (err) { return next(err); }
    }
    if (!fresh) return res.status(403).json({ error: 'Sign out and sign in again before deleting your data or account.', code: 'recent_sign_in_required' });
    next();
}
router.delete('/settings/location', requireAuth, sameOrigin, async (req, res, next) => {
    try { await AccountService.clearLocation(req.userId); res.json({ success: true }); } catch (err) { next(err); }
});
router.delete('/account/data', requireAuth, sameOrigin, recentVerification, async (req, res, next) => {
    if (req.body?.confirmation !== 'DELETE MY DATA') return res.status(400).json({ error: 'Type DELETE MY DATA to confirm' });
    try { await AccountService.clearData(req.userId); res.json({ success: true }); } catch (err) { next(err); }
});
router.delete('/account', requireAuth, sameOrigin, recentVerification, async (req, res, next) => {
    if (req.body?.confirmation !== 'DELETE MY ACCOUNT') return res.status(400).json({ error: 'Type DELETE MY ACCOUNT to confirm' });
    try { await AccountService.deleteAccount(req.userId); res.json({ success: true }); } catch (err) { next(err); }
});
module.exports = router;
