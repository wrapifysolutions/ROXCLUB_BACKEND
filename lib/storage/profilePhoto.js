require('../ensureWebSocket');
const { createClient } = require('@supabase/supabase-js');

const PROFILE_BUCKET = 'profile-photos';
let publicBucketReady = false;

function cloudinarySettings(env = process.env) {
    const cloudName = String(env.CLOUDINARY_CLOUD_NAME || '').trim();
    const apiKey = String(env.CLOUDINARY_API_KEY || '').trim();
    const apiSecret = String(env.CLOUDINARY_API_SECRET || '').trim();
    if (!cloudName || !apiKey || !apiSecret) return null;
    return { cloudName, apiKey, apiSecret };
}

function supabaseSettings(env = process.env) {
    const url = String(env.Project_Url || env.SUPABASE_URL || '').trim();
    const serviceKey = String(env.SupaBase_Secret_Key || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !serviceKey) return null;
    return { url, serviceKey };
}

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const TYPE_BY_EXTENSION = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
};

function httpError(code, status, message) {
    const error = new Error(message || code);
    error.code = code;
    error.status = status;
    return error;
}

function storageStatus(env = process.env) {
    if (cloudinarySettings(env)) {
        return { enabled: true, provider: 'cloudinary' };
    }
    if (supabaseSettings(env)) {
        return { enabled: true, provider: 'supabase' };
    }
    return {
        enabled: false,
        provider: 'cloudinary',
        code: 'STORAGE_NOT_CONFIGURED',
        message:
            'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
    };
}

function isForbidden(cause) {
    const httpCode = cause?.http_code || cause?.httpCode;
    const detail = String(cause?.message || '');
    return httpCode === 403 || /403|missing permissions|forbidden/i.test(detail);
}

function validateProfilePhotoFile(file) {
    if (!file) throw httpError('FILE_REQUIRED', 400, 'Profile photo is required');
    const size = Number(file.size || file.bytes || 0);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_PHOTO_BYTES) {
        throw httpError('FILE_INVALID', 400, 'Profile photo must be a JPEG, PNG, or WebP up to 5 MB');
    }
    const filenameHint = String(file.filename || file.originalname || '');
    const extension = filenameHint.includes('.') ? filenameHint.split('.').pop().toLowerCase() : '';
    const declared = String(file.mimeType || file.mimetype || '')
        .toLowerCase()
        .split(';')[0]
        .trim();
    const type = ALLOWED_TYPES.has(declared)
        ? declared
        : declared === '' || declared === 'application/octet-stream'
          ? TYPE_BY_EXTENSION[extension]
          : declared;
    if (!ALLOWED_TYPES.has(type)) {
        throw httpError('FILE_TYPE_NOT_ALLOWED', 400, 'Profile photo must be a JPEG, PNG, or WebP');
    }
    const name = String(file.filename || file.originalname || 'photo').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
        throw httpError('FILE_INVALID', 400, 'Profile photo filename is invalid');
    }
    return { size, mimeType: type, filename: name };
}

function safeUserFolder(userId) {
    const id = String(userId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
    return id || 'unknown';
}

function serviceStorageClient(env = process.env) {
    const settings = supabaseSettings(env);
    if (!settings) return null;
    return createClient(settings.url, settings.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}

async function ensurePublicPhotoBucket(supabase) {
    if (publicBucketReady) return;
    const created = await supabase.storage.createBucket(PROFILE_BUCKET, {
        public: true,
        fileSizeLimit: MAX_PHOTO_BYTES,
        allowedMimeTypes: [...ALLOWED_TYPES],
    });
    if (created.error && !/already exists/i.test(created.error.message || '')) {
        const updated = await supabase.storage.updateBucket(PROFILE_BUCKET, {
            public: true,
            fileSizeLimit: MAX_PHOTO_BYTES,
            allowedMimeTypes: [...ALLOWED_TYPES],
        });
        if (updated.error && !/already exists/i.test(updated.error.message || '')) {
            throw httpError('STORAGE_UPLOAD_FAILED', 502, 'Profile photo storage is not available');
        }
    }
    publicBucketReady = true;
}

async function uploadSupabasePublicPhoto(file, meta, options = {}) {
    const supabase = options.storageClient || serviceStorageClient(options.env);
    if (!supabase) {
        throw httpError('STORAGE_NOT_CONFIGURED', 503, 'Profile photo storage is not configured');
    }
    if (!options.storageClient) await ensurePublicPhotoBucket(supabase);
    const owner = safeUserFolder(options.userId);
    const ext = meta.mimeType === 'image/png' ? 'png' : meta.mimeType === 'image/webp' ? 'webp' : 'jpg';
    const objectPath = `${owner}/photo.${ext}`;
    const { error } = await supabase.storage.from(PROFILE_BUCKET).upload(objectPath, file.buffer, {
        contentType: meta.mimeType,
        upsert: true,
    });
    if (error) {
        const failure = httpError('STORAGE_UPLOAD_FAILED', 502, 'Profile photo upload failed');
        failure.cause = error;
        throw failure;
    }
    const { data } = supabase.storage.from(PROFILE_BUCKET).getPublicUrl(objectPath);
    const photoUrl = String(data?.publicUrl || '').trim();
    if (!photoUrl || !/^https:\/\//i.test(photoUrl)) {
        throw httpError('STORAGE_UPLOAD_FAILED', 502, 'Profile photo upload failed');
    }
    return {
        photoUrl,
        photoPublicId: `supabase|public|${PROFILE_BUCKET}|${objectPath}`,
        provider: 'supabase',
        access: 'public',
    };
}

async function defaultCloudinaryUpload({ buffer, options, env = process.env }) {
    const settings = cloudinarySettings(env);
    if (!settings) throw httpError('STORAGE_NOT_CONFIGURED', 503, storageStatus(env).message);
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
        cloud_name: settings.cloudName,
        api_key: settings.apiKey,
        api_secret: settings.apiSecret,
        secure: true,
    });
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
            if (error) reject(error);
            else resolve(result);
        });
        stream.end(buffer);
    });
}

async function uploadPublicProfilePhoto(file, options = {}) {
    const status = storageStatus(options.env);
    if (!status.enabled && !options.uploader) {
        throw httpError('STORAGE_NOT_CONFIGURED', 503, status.message);
    }
    const meta = validateProfilePhotoFile(file);
    if (!file.buffer) {
        throw httpError('FILE_REQUIRED', 400, 'Send the photo as multipart form-data in the file field');
    }
    if (options.storageClient && !options.uploader) {
        return uploadSupabasePublicPhoto(file, meta, options);
    }
    const uploader = options.uploader || defaultCloudinaryUpload;
    try {
        const result = await uploader({
            buffer: file.buffer,
            options: {
                folder: 'roxclub/profile-photos',
                public_id: safeUserFolder(options.userId),
                resource_type: 'image',
                overwrite: true,
                invalidate: true,
                unique_filename: false,
            },
            env: options.env,
        });
        const photoUrl = String(result?.secure_url || result?.url || '').trim();
        const photoPublicId = String(result?.public_id || '').trim();
        if (!photoUrl || !/^https:\/\//i.test(photoUrl) || !photoPublicId) {
            throw httpError('STORAGE_UPLOAD_FAILED', 502, 'Profile photo upload failed');
        }
        return {
            photoUrl,
            photoPublicId,
            provider: 'cloudinary',
            access: 'public',
        };
    } catch (cause) {
        if (isForbidden(cause) || cause?.code === 'STORAGE_UPLOAD_FAILED') {
            return uploadSupabasePublicPhoto(file, meta, options);
        }
        const detail = String(cause?.message || cause || 'upload failed');
        const error = httpError(
            'STORAGE_UPLOAD_FAILED',
            502,
            /Invalid image|empty|corrupt/i.test(detail)
                ? 'Profile photo could not be read as an image'
                : 'Profile photo upload failed'
        );
        error.cause = cause;
        throw error;
    }
}

async function destroyProfilePhoto(publicId, options = {}) {
    const id = String(publicId || '').trim();
    if (!id) return { deleted: false };
    if (options.destroyer) {
        await options.destroyer(id);
        return { deleted: true };
    }
    if (id.startsWith('supabase|public|')) {
        const parts = id.split('|');
        const bucket = parts[2];
        const path = parts.slice(3).join('|');
        const supabase = options.storageClient || serviceStorageClient(options.env);
        if (!supabase || !bucket || !path) return { deleted: false };
        await supabase.storage.from(bucket).remove([path]).catch(() => {});
        return { deleted: true };
    }
    const settings = cloudinarySettings(options.env);
    if (!settings) return { deleted: false };
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
        cloud_name: settings.cloudName,
        api_key: settings.apiKey,
        api_secret: settings.apiSecret,
        secure: true,
    });
    await cloudinary.uploader.destroy(id, { resource_type: 'image', invalidate: true }).catch(() => {});
    return { deleted: true };
}

module.exports = {
    MAX_PHOTO_BYTES,
    ALLOWED_TYPES,
    storageStatus,
    validateProfilePhotoFile,
    uploadPublicProfilePhoto,
    destroyProfilePhoto,
};
