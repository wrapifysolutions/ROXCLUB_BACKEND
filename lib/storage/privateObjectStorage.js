const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

function cloudinarySettings(env = process.env) {
    const cloudName = String(env.CLOUDINARY_CLOUD_NAME || '').trim();
    const apiKey = String(env.CLOUDINARY_API_KEY || '').trim();
    const apiSecret = String(env.CLOUDINARY_API_SECRET || '').trim();
    if (!cloudName || !apiKey || !apiSecret) return null;
    return { cloudName, apiKey, apiSecret };
}

function storageStatus(env = process.env) {
    if (!cloudinarySettings(env)) {
        return {
            enabled: false,
            provider: 'cloudinary',
            code: 'STORAGE_NOT_CONFIGURED',
            message:
                'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET. Certification files are not stored.',
        };
    }
    return {
        enabled: true,
        provider: 'cloudinary',
        code: 'CLOUDINARY',
        message: 'Private Cloudinary uploads are enabled.',
    };
}

function validateCertificationFile(file) {
    if (!file) {
        const error = new Error('Certification file is required');
        error.status = 400;
        error.code = 'FILE_REQUIRED';
        throw error;
    }
    const size = Number(file.size || file.bytes || 0);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
        const error = new Error('Certification file must be a PDF, JPEG, or PNG up to 8 MB');
        error.status = 400;
        error.code = 'FILE_INVALID';
        throw error;
    }
    const type = String(file.mimeType || file.mimetype || '').toLowerCase();
    if (!ALLOWED_TYPES.has(type)) {
        const error = new Error('Certification file must be a PDF, JPEG, or PNG');
        error.status = 400;
        error.code = 'FILE_TYPE_NOT_ALLOWED';
        throw error;
    }
    const name = String(file.filename || file.originalname || 'certification').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
        const error = new Error('Certification filename is invalid');
        error.status = 400;
        error.code = 'FILE_INVALID';
        throw error;
    }
    return { size, mimeType: type, filename: name };
}

function resourceTypeFor(mimeType) {
    return mimeType === 'application/pdf' ? 'raw' : 'image';
}

function documentKeyFor(resourceType, publicId) {
    return `cloudinary|authenticated|${resourceType}|${publicId}`;
}

function parseDocumentKey(documentKey) {
    const parts = String(documentKey || '').split('|');
    if (parts.length < 4 || parts[0] !== 'cloudinary' || parts[1] !== 'authenticated') return null;
    return {
        resourceType: parts[2],
        publicId: parts.slice(3).join('|'),
    };
}

function createUploadSlot() {
    const status = storageStatus();
    if (status.enabled) return status;
    const error = new Error(status.message);
    error.status = 503;
    error.code = status.code;
    throw error;
}

async function defaultCloudinaryUpload({ buffer, options, env = process.env }) {
    const settings = cloudinarySettings(env);
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

async function uploadPrivateCertification(file, options = {}) {
    const status = storageStatus(options.env);
    if (!status.enabled) {
        const error = new Error(status.message);
        error.status = 503;
        error.code = status.code;
        throw error;
    }
    const meta = validateCertificationFile(file);
    if (!file.buffer) {
        const error = new Error('Send the certification as multipart form-data in the file field');
        error.status = 400;
        error.code = 'FILE_REQUIRED';
        throw error;
    }
    const resourceType = resourceTypeFor(meta.mimeType);
    const uploader = options.uploader || defaultCloudinaryUpload;
    let result;
    try {
        result = await uploader({
            buffer: file.buffer,
            options: {
                folder: `roxclub/coach-certifications/${options.userId || 'unknown'}`,
                resource_type: resourceType,
                type: 'authenticated',
                access_mode: 'authenticated',
                overwrite: false,
                filename_override: meta.filename,
            },
            env: options.env,
        });
    } catch (cause) {
        const error = new Error('Certification upload failed');
        error.status = 502;
        error.code = 'STORAGE_UPLOAD_FAILED';
        error.cause = cause;
        throw error;
    }
    if (!result?.public_id) {
        const error = new Error('Certification upload failed');
        error.status = 502;
        error.code = 'STORAGE_UPLOAD_FAILED';
        throw error;
    }
    return {
        documentKey: documentKeyFor(resourceType, result.public_id),
        provider: 'cloudinary',
        access: 'authenticated',
    };
}

function signPrivateCertification(documentKey, options = {}) {
    const parsed = parseDocumentKey(documentKey);
    const settings = cloudinarySettings(options.env);
    if (!parsed || !settings) return null;
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
        cloud_name: settings.cloudName,
        api_key: settings.apiKey,
        api_secret: settings.apiSecret,
        secure: true,
    });
    return cloudinary.url(parsed.publicId, {
        resource_type: parsed.resourceType,
        type: 'authenticated',
        sign_url: true,
        secure: true,
        expires_at: Math.floor(Date.now() / 1000) + 600,
    });
}

module.exports = {
    storageStatus,
    validateCertificationFile,
    createUploadSlot,
    uploadPrivateCertification,
    signPrivateCertification,
    parseDocumentKey,
    MAX_BYTES,
    ALLOWED_TYPES,
};
