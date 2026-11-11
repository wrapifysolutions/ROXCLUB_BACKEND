function asAvatar(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (_) {
            return null;
        }
    }
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    return null;
}

function cleanPhotoUrl(value) {
    const text = String(value || '').trim();
    if (!text || text.length > 500) return null;
    if (!/^https:\/\//i.test(text)) return null;
    return text;
}

function splitAvatar(value) {
    const raw = asAvatar(value) || {};
    const nested = raw.photo && typeof raw.photo === 'object' ? raw.photo : {};
    const photoUrl = cleanPhotoUrl(raw.photoUrl || raw.photo_url || nested.url);
    const photoPublicId =
        String(raw.photoPublicId || raw.photo_public_id || nested.publicId || nested.public_id || '').trim() ||
        null;
    const avatar = { ...raw };
    delete avatar.photoUrl;
    delete avatar.photo_url;
    delete avatar.photoPublicId;
    delete avatar.photo_public_id;
    delete avatar.photo;
    return {
        avatar: Object.keys(avatar).length ? avatar : null,
        photoUrl,
        photoPublicId,
    };
}

function withPhoto(avatar, photo) {
    const next = avatar && typeof avatar === 'object' && !Array.isArray(avatar) ? { ...avatar } : {};
    if (photo?.photoUrl) {
        next.photoUrl = photo.photoUrl;
        if (photo.photoPublicId) next.photoPublicId = photo.photoPublicId;
    } else {
        delete next.photoUrl;
        delete next.photoPublicId;
    }
    return next;
}

module.exports = {
    asAvatar,
    cleanPhotoUrl,
    splitAvatar,
    withPhoto,
};
