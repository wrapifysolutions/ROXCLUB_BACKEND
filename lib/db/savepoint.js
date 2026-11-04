async function withSavepoint(query, name, work) {
    const token = `sp_${String(name || 'x').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24)}`;
    let opened = false;
    try {
        await query(`SAVEPOINT ${token}`);
        opened = true;
    } catch (error) {
        if (!error.code) return work();
        throw error;
    }
    try {
        const result = await work();
        try {
            await query(`RELEASE SAVEPOINT ${token}`);
        } catch (_) {
            // Release is optional once the statement succeeded.
        }
        return result;
    } catch (error) {
        if (opened) {
            try {
                await query(`ROLLBACK TO SAVEPOINT ${token}`);
            } catch (_) {
                // Connection may already be aborted.
            }
        }
        throw error;
    }
}

module.exports = { withSavepoint };
