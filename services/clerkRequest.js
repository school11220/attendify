// Clerk rejects throttled requests before applying a mutation. Retry those only;
// never retry ambiguous network failures or arbitrary provider errors.
async function clerkRequest(operation) {
    for (let attempt = 0; ; attempt++) {
        try { return await operation(); }
        catch (error) {
            const seconds = Number(error.retryAfter ?? 1);
            if (error.status !== 429 || attempt >= 2 || !Number.isFinite(seconds) || seconds > 10) throw error;
            await new Promise(resolve => setTimeout(resolve, Math.max(1, seconds) * 1000));
        }
    }
}
module.exports = clerkRequest;
