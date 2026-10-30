const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const MAX_BYTES = 8 * 1024 * 1024;
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', DOCX_TYPE]);
const TYPE_BY_EXTENSION = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    docx: DOCX_TYPE,
};
const FILE_TYPE_MESSAGE = 'Certification file must be a PDF, JPEG, PNG, or DOCX';
const CERTIFICATION_BUCKET = 'coach-certifications';
let privateBucketReady = false;

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

function storageStatus(env = process.env) {
    if (cloudinarySettings(env)) {
        return {
            enabled: true,
            provider: 'cloudinary',
            code: 'CLOUDINARY',
            message: 'Private Cloudinary uploads are enabled.',
        };
    }
    return {
        enabled: false,
        provider: 'cloudinary',
        code: 'STORAGE_NOT_CONFIGURED',
        message:
            'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET. Certification files are not stored.',
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
        const error = new Error(`${FILE_TYPE_MESSAGE} up to 8 MB`);
        error.status = 400;
        error.code = 'FILE_INVALID';
        throw error;
    }
    const filenameHint = String(file.filename || file.originalname || '');
    const extension = filenameHint.includes('.') ? filenameHint.split('.').pop().toLowerCase() : '';
    const declared = String(file.mimeType || file.mimetype || '')
        .toLowerCase()
        .split(';')[0]
        .trim();
    const type =
        ALLOWED_TYPES.has(declared)
            ? declared
            : declared === '' || declared === 'application/octet-stream'
              ? TYPE_BY_EXTENSION[extension]
              : declared;
    if (!ALLOWED_TYPES.has(type)) {
        const error = new Error(FILE_TYPE_MESSAGE);
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
    return mimeType === 'image/jpeg' || mimeType === 'image/png' ? 'image' : 'raw';
}

function documentKeyFor(resourceType, publicId) {
    return `cloudinary|authenticated|${resourceType}|${publicId}`;
}

function parseDocumentKey(documentKey) {
    const parts = String(documentKey || '').split('|');
    if (parts.length < 4) return null;
    if (parts[0] === 'supabase' && parts[1] === 'private') {
        return {
            provider: 'supabase',
            bucket: parts[2],
            path: parts.slice(3).join('|'),
        };
    }
    if (parts[0] !== 'cloudinary' || parts[1] !== 'authenticated') return null;
    return {
        provider: 'cloudinary',
        resourceType: parts[2],
        publicId: parts.slice(3).join('|'),
    };
}

function serviceStorageClient(env = process.env) {
    const settings = supabaseSettings(env);
    if (!settings) return null;
    return createClient(settings.url, settings.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}

async function ensurePrivateBucket(supabase) {
    if (privateBucketReady) return;
    const bucketOptions = {
        public: false,
        fileSizeLimit: MAX_BYTES,
        allowedMimeTypes: [...ALLOWED_TYPES],
    };
    const created = await supabase.storage.createBucket(CERTIFICATION_BUCKET, bucketOptions);
    if (created.error && /already exists/i.test(created.error.message || '')) {
        const updated = await supabase.storage.updateBucket(CERTIFICATION_BUCKET, bucketOptions);
        if (updated.error) {
            const failure = new Error('Certification storage is not available');
            failure.status = 502;
            failure.code = 'STORAGE_UPLOAD_FAILED';
            throw failure;
        }
    } else if (created.error) {
        const failure = new Error('Certification storage is not available');
        failure.status = 502;
        failure.code = 'STORAGE_UPLOAD_FAILED';
        throw failure;
    }
    privateBucketReady = true;
}

async function uploadSupabaseCertification(file, meta, options = {}) {
    const supabase = options.storageClient || serviceStorageClient(options.env);
    if (!supabase) {
        const error = new Error('Certification storage is not configured');
        error.status = 503;
        error.code = 'STORAGE_NOT_CONFIGURED';
        throw error;
    }
    if (!options.storageClient) await ensurePrivateBucket(supabase);
    const owner = String(options.userId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
    const objectPath = `${owner || 'unknown'}/${crypto.randomUUID()}-${meta.filename}`;
    const { error } = await supabase.storage.from(CERTIFICATION_BUCKET).upload(objectPath, file.buffer, {
        contentType: meta.mimeType,
        upsert: false,
    });
    if (error) {
        const failure = new Error('Certification upload failed');
        failure.status = 502;
        failure.code = 'STORAGE_UPLOAD_FAILED';
        failure.cause = error;
        throw failure;
    }
    return {
        documentKey: `supabase|private|${CERTIFICATION_BUCKET}|${objectPath}`,
        provider: 'supabase',
        access: 'private',
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
    if (options.storageClient) {
        return uploadSupabaseCertification(file, meta, options);
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

async function signPrivateCertification(documentKey, options = {}) {
    const parsed = parseDocumentKey(documentKey);
    if (!parsed) return null;
    if (parsed.provider === 'supabase') {
        const supabase = options.storageClient || serviceStorageClient(options.env);
        if (!supabase || !parsed.path) return null;
        const { data, error } = await supabase.storage.from(parsed.bucket).createSignedUrl(parsed.path, 600);
        if (error || !data?.signedUrl) return null;
        return data.signedUrl;
    }
    const settings = cloudinarySettings(options.env);
    if (!settings) return null;
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
