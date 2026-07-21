
import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const MAX_NAME_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 500;
const MAX_SUBMISSION_ID_LENGTH = 120;

function json(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(payload);
}

function getDatabase() {
  const url = process.env.SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !secretKey) {
    throw new Error('Missing Supabase environment variables.');
  }

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function parseBody(body) {
  if (!body) return {};

  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }

  return body;
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');

  if (leftBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorizedAdmin(req) {
  const configuredKey = process.env.RSVP_ADMIN_KEY;
  const providedKey = req.headers['x-admin-key'];

  return Boolean(configuredKey) && secureEqual(providedKey, configuredKey);
}

function validateSubmission(body) {
  const name = String(body.name || '').trim();
  const message = String(body.message || '').trim();
  const attending = body.attending;
  const clientSubmissionId = String(body.clientSubmissionId || '').trim();

  if (name.length < 2 || name.length > MAX_NAME_LENGTH) {
    return { error: 'الاسم يجب أن يكون بين حرفين و100 حرف.' };
  }

  if (typeof attending !== 'boolean') {
    return { error: 'حالة الحضور غير صالحة.' };
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return { error: 'الرسالة طويلة جداً. الحد الأقصى 500 حرف.' };
  }

  if (
    clientSubmissionId.length < 8 ||
    clientSubmissionId.length > MAX_SUBMISSION_ID_LENGTH ||
    !/^[a-zA-Z0-9_-]+$/.test(clientSubmissionId)
  ) {
    return { error: 'معرّف الإرسال غير صالح.' };
  }

  return {
    value: {
      name,
      attending,
      message,
      client_submission_id: clientSubmissionId
    }
  };
}

async function handlePost(req, res) {
  const body = parseBody(req.body);
  const validation = validateSubmission(body);

  if (validation.error) {
    return json(res, 400, {
      ok: false,
      message: validation.error
    });
  }

  const database = getDatabase();
  const { data, error } = await database
    .from('rsvp_responses')
    .insert(validation.value)
    .select('id, name, attending, message, created_at')
    .single();

  if (error?.code === '23505') {
    return json(res, 200, {
      ok: true,
      duplicate: true,
      message: 'تم حفظ الرد مسبقاً.'
    });
  }

  if (error) {
    console.error('Supabase insert error:', error);
    return json(res, 500, {
      ok: false,
      message: 'تعذّر حفظ الرد حالياً. حاول مرة أخرى.'
    });
  }

  return json(res, 201, {
    ok: true,
    response: data
  });
}

async function handleGet(req, res) {
  if (!isAuthorizedAdmin(req)) {
    return json(res, 401, {
      ok: false,
      message: 'كلمة مرور لوحة الحضور غير صحيحة.'
    });
  }

  const database = getDatabase();
  const { data, error } = await database
    .from('rsvp_responses')
    .select('id, name, attending, message, created_at')
    .order('created_at', { ascending: false })
    .limit(2000);

  if (error) {
    console.error('Supabase select error:', error);
    return json(res, 500, {
      ok: false,
      message: 'تعذّر تحميل الردود حالياً.'
    });
  }

  return json(res, 200, {
    ok: true,
    responses: data || []
  });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      return await handlePost(req, res);
    }

    if (req.method === 'GET') {
      return await handleGet(req, res);
    }

    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, {
      ok: false,
      message: 'طريقة الطلب غير مدعومة.'
    });
  } catch (error) {
    console.error('RSVP API error:', error);
    return json(res, 500, {
      ok: false,
      message: 'الخادم غير مهيأ بشكل صحيح.'
    });
  }
}
