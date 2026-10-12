const clerkRequest = require('./clerkRequest');
const { clerkClient } = require('@clerk/express');
const validDate = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
function normalizeCalendar(value = {}) {
    const calendar = {
        holidays: [...new Set((Array.isArray(value.holidays) ? value.holidays : []).filter(validDate))].sort(),
        cancellations: (Array.isArray(value.cancellations) ? value.cancellations : [])
            .filter(item => item && validDate(item.date) && typeof item.subjectId === 'string')
            .filter((item, index, items) => items.findIndex(other => other.date === item.date && other.subjectId === item.subjectId) === index)
            .map(({ date, subjectId }) => ({ date, subjectId }))
    };
    // Date-keyed patches allow different devices to change different dates without
    // overwriting the entire holiday/cancellation collection.
    for (const [date, enabled] of Object.entries(value.holidayDates || {})) {
        if (!validDate(date) || typeof enabled !== 'boolean') continue;
        calendar.holidays = calendar.holidays.filter(item => item !== date);
        if (enabled) calendar.holidays.push(date);
    }
    for (const [date, subjects] of Object.entries(value.cancelledDates || {})) {
        if (!validDate(date) || !subjects || typeof subjects !== 'object') continue;
        for (const [subjectId, enabled] of Object.entries(subjects)) {
            if (typeof enabled !== 'boolean') continue;
            calendar.cancellations = calendar.cancellations.filter(item => item.date !== date || item.subjectId !== subjectId);
            if (enabled) calendar.cancellations.push({ date, subjectId });
        }
    }
    calendar.holidays.sort();
    return calendar;
}
function isExcluded(calendar, date, subjectId) {
    return calendar.holidays.includes(date) || calendar.cancellations.some(item => item.date === date && item.subjectId === String(subjectId));
}
class CalendarService {
    static async get(userId) {
        const user = await clerkRequest(() => clerkClient.users.getUser(userId));
        return normalizeCalendar(user.privateMetadata.attendify_calendar);
    }
    static async save(userId, calendar) {
        const normalized = normalizeCalendar(calendar);
        await clerkRequest(() => clerkClient.users.updateUserMetadata(userId, { privateMetadata: { attendify_calendar: { ...normalized, holidayDates: null, cancelledDates: null } } }));
        return normalized;
    }
    static async holiday(userId, date, enabled) {
        await clerkRequest(() => clerkClient.users.updateUserMetadata(userId, { privateMetadata: { attendify_calendar: { holidayDates: { [date]: enabled } } } }));
        return this.get(userId);
    }
    static async cancel(userId, date, subjectId, enabled) {
        await clerkRequest(() => clerkClient.users.updateUserMetadata(userId, { privateMetadata: { attendify_calendar: { cancelledDates: { [date]: { [subjectId]: enabled } } } } }));
        return this.get(userId);
    }
}
module.exports = { CalendarService, normalizeCalendar, validDate, isExcluded };
