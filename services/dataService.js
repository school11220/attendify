const { clerkClient } = require('@clerk/express');

function normalizePercentage(value, fallback = 75.0) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(100, Math.max(0, parsed));
}

function isApproximatelyEqual(a, b, epsilon = 0.001) {
    return Math.abs(a - b) <= epsilon;
}

// Default user data structure
function defaultUserData() {
    return {
        profile: {
            name: '',
            college: '',
            semester: '',
            attendance_requirement_percentage: 75.0
        },
        subjects: [],
        timetable: [],
        college_location: null  // { lat, lng, radius }
    };
}

class DataService {

    static async getUserData(userId) {
        try {
            const user = await clerkClient.users.getUser(userId);
            const meta = user.privateMetadata;
            if (!meta || !meta.attendify) {
                const data = defaultUserData();
                await clerkClient.users.updateUserMetadata(userId, {
                    privateMetadata: { attendify: data }
                });
                return data;
            }
            const d = meta.attendify;
            if (!d.profile) d.profile = defaultUserData().profile;
            if (!d.subjects) d.subjects = [];
            if (!d.timetable) d.timetable = [];
            if (d.college_location === undefined) d.college_location = null;

            d.profile.attendance_requirement_percentage = normalizePercentage(
                d.profile.attendance_requirement_percentage,
                defaultUserData().profile.attendance_requirement_percentage
            );

            d.subjects = (d.subjects || []).map(subject => {
                const totalClasses = Math.max(0, Number(subject.total_classes) || 0);
                const attendedClasses = Math.min(totalClasses, Math.max(0, Number(subject.attended_classes) || 0));

                return {
                    ...subject,
                    min_requirement_percentage: normalizePercentage(
                        subject.min_requirement_percentage,
                        d.profile.attendance_requirement_percentage
                    ),
                    total_classes: totalClasses,
                    attended_classes: attendedClasses,
                    history: Array.isArray(subject.history) ? subject.history : []
                };
            });

            return d;
        } catch (err) {
            console.error('Error reading Clerk metadata:', err.name);
            throw new Error('Unable to read attendance data. Please try again.');
        }
    }

    static async saveUserData(userId, userData) {
        try {
            await clerkClient.users.updateUserMetadata(userId, {
                privateMetadata: { attendify: userData }
            });
        } catch (err) {
            console.error('Error writing Clerk metadata:', err.name);
            throw err;
        }
    }

    static async getProfile(userId) {
        const data = await this.getUserData(userId);
        return data.profile;
    }

    static async updateProfile(userId, profileUpdates) {
        const data = await this.getUserData(userId);

        const previousRequirement = normalizePercentage(
            data.profile.attendance_requirement_percentage,
            defaultUserData().profile.attendance_requirement_percentage
        );

        const hasRequirementUpdate = profileUpdates.attendance_requirement_percentage !== undefined;
        const nextRequirement = hasRequirementUpdate
            ? normalizePercentage(profileUpdates.attendance_requirement_percentage, previousRequirement)
            : previousRequirement;

        data.profile = {
            ...data.profile,
            ...profileUpdates,
            attendance_requirement_percentage: nextRequirement
        };

        if (hasRequirementUpdate) {
            data.subjects = (data.subjects || []).map(subject => {
                const normalizedSubjectRequirement = normalizePercentage(subject.min_requirement_percentage, previousRequirement);
                const hasInvalidRequirement = !Number.isFinite(Number.parseFloat(subject.min_requirement_percentage));
                const shouldSyncWithGlobal =
                    subject.min_requirement_percentage === undefined ||
                    subject.min_requirement_percentage === null ||
                    hasInvalidRequirement ||
                    isApproximatelyEqual(normalizedSubjectRequirement, previousRequirement);

                return {
                    ...subject,
                    min_requirement_percentage: shouldSyncWithGlobal
                        ? nextRequirement
                        : normalizedSubjectRequirement
                };
            });
        }

        await this.saveUserData(userId, data);
        return data.profile;
    }

    static async getSubjects(userId) {
        const data = await this.getUserData(userId);
        return data.subjects;
    }

    static async getSubjectById(userId, subjectId) {
        const subjects = await this.getSubjects(userId);
        return subjects.find(s => s.id === subjectId.toString());
    }

    static async createSubject(userId, subjectData) {
        const data = await this.getUserData(userId);
        const defaultRequirement = normalizePercentage(
            data.profile && data.profile.attendance_requirement_percentage,
            defaultUserData().profile.attendance_requirement_percentage
        );

        const newSubject = {
            id: Date.now().toString(),
            subject_name: subjectData.subject_name,
            faculty_name: subjectData.faculty_name,
            min_requirement_percentage: normalizePercentage(subjectData.min_requirement_percentage, defaultRequirement),
            total_classes: 0,
            attended_classes: 0,
            history: []
        };
        data.subjects.push(newSubject);
        await this.saveUserData(userId, data);
        return newSubject;
    }

    static async deleteSubject(userId, subjectId) {
        const data = await this.getUserData(userId);
        data.subjects = data.subjects.filter(s => s.id !== subjectId.toString());
        // Also remove timetable slots for this subject
        data.timetable = (data.timetable || []).filter(t => t.subjectId !== subjectId.toString());
        await this.saveUserData(userId, data);
    }

    static async deleteAttendanceRecord(userId, subjectId, recordId) {
        const data = await this.getUserData(userId);
        const subject = data.subjects.find(s => s.id === subjectId.toString());
        if (!subject) return false;

        const recordIndex = subject.history.findIndex(r => r.id === recordId.toString());
        if (recordIndex === -1) return false;

        const record = subject.history[recordIndex];
        if (record.status === 'present' || record.status === 'extra') {
            subject.attended_classes = Math.max(0, subject.attended_classes - 1);
            subject.total_classes = Math.max(0, subject.total_classes - 1);
        } else if (record.status === 'absent') {
            subject.total_classes = Math.max(0, subject.total_classes - 1);
        }

        subject.history.splice(recordIndex, 1);
        await this.saveUserData(userId, data);
        return true;
    }

    static async markAttendance(userId, subjectId, status, date) {
        const data = await this.getUserData(userId);
        const subject = data.subjects.find(s => s.id === subjectId.toString());
        if (!subject) throw new Error('Subject not found');

        const newRecord = {
            id: Date.now().toString() + Math.floor(Math.random() * 1000).toString(),
            date: date,
            status: status
        };

        if (status === 'present' || status === 'extra') {
            subject.attended_classes += 1;
            subject.total_classes += 1;
        } else if (status === 'absent') {
            subject.total_classes += 1;
        }

        subject.history.push(newRecord);
        subject.history.sort((a, b) => new Date(b.date) - new Date(a.date));

        await this.saveUserData(userId, data);
        return newRecord;
    }

    // --- Timetable ---

    static async getTimetable(userId) {
        const data = await this.getUserData(userId);
        return data.timetable || [];
    }

    static async addTimetableSlot(userId, slot) {
        const data = await this.getUserData(userId);
        const newSlot = {
            id: Date.now().toString(),
            subjectId: slot.subjectId.toString(),
            day: slot.day,          // 'monday', 'tuesday', etc.
            startTime: slot.startTime, // 'HH:MM'
            endTime: slot.endTime      // 'HH:MM'
        };
        data.timetable = data.timetable || [];
        data.timetable.push(newSlot);
        await this.saveUserData(userId, data);
        return newSlot;
    }

    static async updateTimetableSlot(userId, slotId, slot) {
        const data = await this.getUserData(userId);
        data.timetable = data.timetable || [];
        const slotIndex = data.timetable.findIndex(t => t.id === slotId.toString());
        if (slotIndex === -1) return null;

        const updatedSlot = {
            ...data.timetable[slotIndex],
            subjectId: slot.subjectId.toString(),
            day: slot.day,
            startTime: slot.startTime,
            endTime: slot.endTime
        };

        data.timetable[slotIndex] = updatedSlot;
        await this.saveUserData(userId, data);
        return updatedSlot;
    }

    static async deleteTimetableSlot(userId, slotId) {
        const data = await this.getUserData(userId);
        data.timetable = (data.timetable || []).filter(t => t.id !== slotId.toString());
        await this.saveUserData(userId, data);
    }

    // --- College Location ---

    static async getCollegeLocation(userId) {
        const data = await this.getUserData(userId);
        return data.college_location || null;
    }

    static async saveCollegeLocation(userId, location) {
        const data = await this.getUserData(userId);
        data.college_location = {
            lat: parseFloat(location.lat),
            lng: parseFloat(location.lng),
            radius: parseInt(location.radius) || 150
        };
        await this.saveUserData(userId, data);
        return data.college_location;
    }
}

module.exports = DataService;
