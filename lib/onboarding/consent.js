function readConsent(body = {}) {
    const accepted =
        body.consent_accepted === true ||
        (body.privacy_accepted === true && body.terms_accepted === true);

    if (!accepted) return null;

    const version = String(body.consent_version || '1').trim().slice(0, 40) || '1';
    return { version };
}

module.exports = { readConsent };
