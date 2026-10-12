const clerkRequest = require('./clerkRequest');
const { clerkClient } = require('@clerk/express');
const defaults = { autoAttendance: true, reminders: true };
class AccountService {
    static async getPreferences(userId) {
        const user = await clerkRequest(() => clerkClient.users.getUser(userId));
        const settings = user.privateMetadata.attendify_settings || {};
        return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, typeof settings[key] === 'boolean' ? settings[key] : fallback]));
    }
    static async setPreferences(userId, settings) {
        await clerkRequest(() => clerkClient.users.updateUserMetadata(userId, { privateMetadata: { attendify_settings: settings } }));
        return this.getPreferences(userId);
    }
    static async clearLocation(userId) {
        await clerkRequest(() => clerkClient.users.updateUserMetadata(userId, { privateMetadata: { attendify: { college_location: null } } }));
    }
    static async clearData(userId) {
        await clerkRequest(() => clerkClient.users.updateUserMetadata(userId, { privateMetadata: {
            attendify: null, attendify_calendar: null,
            attendify_settings: { autoAttendance: false, reminders: false }
        } }));
    }
    static async deleteAccount(userId) { await clerkRequest(() => clerkClient.users.deleteUser(userId)); }
}
module.exports = AccountService;
