// Booking notifications: email (Resend) + SMS (Twilio).
//
// Entry points are async but fire-and-forget from the HTTP layer — callers
// invoke them via setImmediate after the booking transaction commits, so a
// notifier error never breaks the booking response.
//
//   sendBookingCreated(bookingId)
//     - To customer: confirmation email with the salon's
//       booking_confirmation_text inlined (when users.notify_email_bookings).
//     - To salon owner: "Ny booking" email (when
//       salons.notify_email_new_booking) and/or SMS (when
//       salons.notify_sms_new_booking).
//     - For recurring series: ONE notification per recipient covering all
//       occurrences. Call this once with the parent booking id; the function
//       loads the series itself.
//
//   sendBookingConfirmed(bookingId)
//     - Customer-side confirmation when status flips to 'confirmed'.
//
//   sendBookingCancelled(bookingId, by)
//     - by = 'customer' | 'salon' | 'admin'.
//     - customer-cancellation → owner email (opt-out via notify_email_cancellation).
//     - salon/admin-cancellation → customer email (no opt-out; service-critical).
//
//   sendBookingReminder(bookingId)
//     - Customer-side 24h-before reminder (email and/or SMS by user prefs).
//     - Dedups via notification_log: skipped if a 'sent' row already exists
//       for (booking_id, kind starting with 'booking_reminder.').
//
//   runReminderSweep()
//     - Convenience entry for a cron job. Calls findBookingsNeedingReminders()
//       and then sendBookingReminder() for each. INTENTIONALLY NOT scheduled
//       in-process — wire up via Hostinger cron or a GitHub Action, e.g.:
//         node -e "require('./backend/lib/notify').runReminderSweep()"
//       once per hour. The dedup index makes it safe to over-invoke.

const config = require('../../config');
const { query, queryOne } = require('../../db');
const { sendEmail } = require('./email');
const { sendSms } = require('./sms');
const T = require('./templates');

// log() — append a row to notification_log. Never throws; if it fails we
// console.error and move on so the caller doesn't crash.
async function log({ bookingId, userId, channel, kind, recipient, providerId, status, error }) {
  try {
    await query(
      `INSERT INTO notification_log
         (booking_id, user_id, channel, kind, recipient, provider_id, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bookingId || null,
        userId || null,
        channel,
        kind,
        String(recipient || '').slice(0, 255),
        providerId || null,
        status,
        error ? String(error).slice(0, 1000) : null,
      ]
    );
  } catch (err) {
    console.error('[notify-log] insert failed', err && err.message ? err.message : err);
  }
}

async function loadBookingContext(bookingId) {
  const row = await queryOne(
    `SELECT b.id, b.customer_user_id, b.start_at, b.end_at, b.status, b.price_nok,
            b.customer_note, b.guest_name, b.guest_phone,
            b.series_id, b.series_position, b.series_total,
            s.id AS salon_id, s.slug AS salon_slug, s.name AS salon_name,
            s.address_line AS salon_address_line,
            s.postal_code  AS salon_postal_code,
            s.city         AS salon_city,
            s.lat AS salon_lat, s.lng AS salon_lng,
            s.public_phone_visible,
            s.cancellation_lead_hours,
            s.booking_confirmation_text,
            s.notify_email_new_booking,
            s.notify_email_cancellation,
            s.notify_sms_new_booking,
            sv.name AS service_name, sv.duration_min,
            tm.name AS team_member_name,
            cu.id AS customer_id, cu.name AS customer_name, cu.email AS customer_email,
            cu.phone AS customer_phone,
            cu.notify_email_bookings, cu.notify_email_reminders, cu.notify_sms_reminders,
            o.id AS owner_id, o.name AS owner_name, o.email AS owner_email,
            o.phone AS owner_phone
       FROM bookings b
       JOIN salons s   ON s.id  = b.salon_id
       JOIN services sv ON sv.id = b.service_id
       JOIN users o    ON o.id  = s.owner_user_id
       LEFT JOIN team_members tm ON tm.id = b.team_member_id
       LEFT JOIN users cu ON cu.id = b.customer_user_id
      WHERE b.id = ?`,
    [bookingId]
  );
  if (!row) return null;

  const salonAddress = [
    row.salon_address_line,
    [row.salon_postal_code, row.salon_city].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');

  return {
    booking: {
      id: row.id,
      customer_user_id: row.customer_user_id,
      start_at: row.start_at,
      end_at: row.end_at,
      status: row.status,
      price_nok: row.price_nok,
      guest_name: row.guest_name,
      guest_phone: row.guest_phone,
      series_id: row.series_id,
      series_position: row.series_position,
      series_total: row.series_total,
    },
    salon: {
      id: row.salon_id,
      slug: row.salon_slug,
      name: row.salon_name,
      address: salonAddress,
      address_line: row.salon_address_line,
      postal_code: row.salon_postal_code,
      city: row.salon_city,
      lat: row.salon_lat != null ? Number(row.salon_lat) : null,
      lng: row.salon_lng != null ? Number(row.salon_lng) : null,
      public_phone_visible: !!row.public_phone_visible,
      cancellation_lead_hours: Number(row.cancellation_lead_hours) || 0,
      booking_confirmation_text: row.booking_confirmation_text,
      notify_email_new_booking: !!row.notify_email_new_booking,
      notify_email_cancellation: !!row.notify_email_cancellation,
      notify_sms_new_booking: !!row.notify_sms_new_booking,
    },
    service: {
      name: row.service_name,
      duration_min: row.duration_min,
    },
    team_member: row.team_member_name ? { name: row.team_member_name } : null,
    customer_note: row.customer_note || null,
    customer: row.customer_id ? {
      id: row.customer_id,
      name: row.customer_name,
      email: row.customer_email,
      phone: row.customer_phone,
      notify_email_bookings: !!row.notify_email_bookings,
      notify_email_reminders: !!row.notify_email_reminders,
      notify_sms_reminders: !!row.notify_sms_reminders,
    } : null,
    owner: {
      id: row.owner_id,
      name: row.owner_name,
      email: row.owner_email,
      phone: row.owner_phone,
    },
  };
}

// For a parent booking that owns a series, returns the chronologically-ordered
// list of [{ id, start_at, end_at }] for all occurrences in that series.
// Returns null when the booking is not part of a series.
async function loadSeriesOccurrences(seriesId) {
  if (!seriesId) return null;
  const rows = await query(
    `SELECT id, start_at, end_at, status
       FROM bookings
      WHERE series_id = ?
      ORDER BY start_at ASC`,
    [seriesId]
  );
  return rows.length > 1 ? rows : null;
}

function customerDisplayName(ctx) {
  if (ctx.customer && ctx.customer.name) return ctx.customer.name;
  if (ctx.booking.guest_name) return ctx.booking.guest_name;
  return '';
}

function customerEmail(ctx) {
  return ctx.customer ? ctx.customer.email : null;
}

function customerPhone(ctx) {
  if (ctx.customer && ctx.customer.phone) return ctx.customer.phone;
  return ctx.booking.guest_phone || null;
}

// emailDisabledLogged — track once-per-process so we don't spam logs.
let emailDisabledLogged = false;
let smsDisabledLogged = false;

async function emailSendAndLog({ bookingId, userId, kind, to, subject, html, text, replyTo }) {
  if (!to) {
    await log({ bookingId, userId, channel: 'email', kind, recipient: '', status: 'skipped', error: 'no_recipient' });
    return;
  }
  if (!config.notify.email.enabled()) {
    if (!emailDisabledLogged) {
      console.log('[notify] email disabled — RESEND_API_KEY not set');
      emailDisabledLogged = true;
    }
    await log({ bookingId, userId, channel: 'email', kind, recipient: to, status: 'skipped', error: 'email_disabled' });
    return;
  }
  const result = await sendEmail({ to, subject, html, text, replyTo });
  await log({
    bookingId, userId, channel: 'email', kind, recipient: to,
    providerId: result.id || null,
    status: result.ok ? 'sent' : 'failed',
    error: result.ok ? null : result.error,
  });
}

async function smsSendAndLog({ bookingId, userId, kind, to, body }) {
  if (!to) {
    await log({ bookingId, userId, channel: 'sms', kind, recipient: '', status: 'skipped', error: 'no_recipient' });
    return;
  }
  if (!config.notify.sms.enabled()) {
    if (!smsDisabledLogged) {
      console.log('[notify] sms disabled — TWILIO_* env not set');
      smsDisabledLogged = true;
    }
    await log({ bookingId, userId, channel: 'sms', kind, recipient: to, status: 'skipped', error: 'sms_disabled' });
    return;
  }
  const result = await sendSms({ to, body });
  await log({
    bookingId, userId, channel: 'sms', kind, recipient: to,
    providerId: result.id || null,
    status: result.ok ? 'sent' : 'failed',
    error: result.ok ? null : result.error,
  });
}

// sendBookingCreated — fired after POST /bookings commits. For a series, this
// should be called with the PARENT booking id only; the function fans out the
// occurrence list into a single notification per recipient.
async function sendBookingCreated(bookingId) {
  try {
    const ctx = await loadBookingContext(bookingId);
    if (!ctx) return;
    // If this is a series child (series_id != id), skip — the parent send covers it.
    if (ctx.booking.series_id && Number(ctx.booking.series_id) !== Number(ctx.booking.id)) {
      return;
    }

    const occurrences = ctx.booking.series_id
      ? await loadSeriesOccurrences(ctx.booking.series_id)
      : null;

    const cName = customerDisplayName(ctx);
    const cPhone = customerPhone(ctx);

    const replyTo = config.notify.email.replyTo;

    // -- Customer email (only when there IS a registered customer)
    if (ctx.customer && ctx.customer.notify_email_bookings) {
      const tmpl = T.bookingCreatedCustomer({
        customerName: ctx.customer.name,
        salon: ctx.salon,
        salonPhone: ctx.salon.public_phone_visible ? ctx.owner.phone : null,
        serviceName: ctx.service.name,
        durationMin: ctx.service.duration_min,
        teamMemberName: ctx.team_member ? ctx.team_member.name : null,
        startAt: ctx.booking.start_at,
        endAt: ctx.booking.end_at,
        priceNok: ctx.booking.price_nok,
        customerNote: ctx.customer_note,
        confirmationText: ctx.salon.booking_confirmation_text,
        cancellationLeadHours: ctx.salon.cancellation_lead_hours,
        occurrences,
        bookingId: ctx.booking.id,
      });
      await emailSendAndLog({
        bookingId: ctx.booking.id,
        userId: ctx.customer.id,
        kind: 'booking_created.customer',
        to: ctx.customer.email,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
        replyTo,
      });
    }

    // -- Owner email
    if (ctx.salon.notify_email_new_booking) {
      const tmpl = T.bookingCreatedOwner({
        ownerName: ctx.owner.name,
        salonName: ctx.salon.name,
        serviceName: ctx.service.name,
        durationMin: ctx.service.duration_min,
        priceNok: ctx.booking.price_nok,
        teamMemberName: ctx.team_member ? ctx.team_member.name : null,
        startAt: ctx.booking.start_at,
        endAt: ctx.booking.end_at,
        customerDisplayName: cName,
        customerPhone: cPhone,
        customerNote: ctx.customer_note,
        isGuest: !ctx.customer,
        bookingId: ctx.booking.id,
        occurrences,
      });
      await emailSendAndLog({
        bookingId: ctx.booking.id,
        userId: ctx.owner.id,
        kind: 'booking_created.owner',
        to: ctx.owner.email,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
        replyTo,
      });
    }

    // -- Owner SMS
    if (ctx.salon.notify_sms_new_booking) {
      const body = T.bookingCreatedOwnerSms({
        salonName: ctx.salon.name,
        serviceName: ctx.service.name,
        startAt: ctx.booking.start_at,
        customerDisplayName: cName,
        occurrences,
      });
      await smsSendAndLog({
        bookingId: ctx.booking.id,
        userId: ctx.owner.id,
        kind: 'booking_created.owner_sms',
        to: ctx.owner.phone,
        body,
      });
    }
  } catch (err) {
    console.error('[notify] sendBookingCreated failed', err && err.message ? err.message : err);
  }
}

async function sendBookingConfirmed(bookingId) {
  try {
    const ctx = await loadBookingContext(bookingId);
    if (!ctx || !ctx.customer) return;
    if (!ctx.customer.notify_email_bookings) return;
    const tmpl = T.bookingConfirmedCustomer({
      customerName: ctx.customer.name,
      salonName: ctx.salon.name,
      serviceName: ctx.service.name,
      startAt: ctx.booking.start_at,
      confirmationText: ctx.salon.booking_confirmation_text,
      bookingId: ctx.booking.id,
    });
    await emailSendAndLog({
      bookingId: ctx.booking.id,
      userId: ctx.customer.id,
      kind: 'booking_confirmed.customer',
      to: ctx.customer.email,
      subject: tmpl.subject,
      html: tmpl.html,
      text: tmpl.text,
      replyTo: config.notify.email.replyTo,
    });
  } catch (err) {
    console.error('[notify] sendBookingConfirmed failed', err && err.message ? err.message : err);
  }
}

async function sendBookingCancelled(bookingId, by) {
  try {
    const ctx = await loadBookingContext(bookingId);
    if (!ctx) return;
    const actor = by === 'salon' || by === 'admin' ? 'salon' : 'customer';

    if (actor === 'customer') {
      // Customer cancelled → tell the owner (opt-out via notify_email_cancellation).
      if (!ctx.salon.notify_email_cancellation) return;
      const tmpl = T.bookingCancelledOwner({
        ownerName: ctx.owner.name,
        salonName: ctx.salon.name,
        serviceName: ctx.service.name,
        startAt: ctx.booking.start_at,
        customerDisplayName: customerDisplayName(ctx),
      });
      await emailSendAndLog({
        bookingId: ctx.booking.id,
        userId: ctx.owner.id,
        kind: 'booking_cancelled.owner',
        to: ctx.owner.email,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
      });
    } else {
      // Salon/admin cancelled → tell the customer. No opt-out: service-critical.
      if (!ctx.customer || !ctx.customer.email) return;
      const tmpl = T.bookingCancelledCustomer({
        customerName: ctx.customer.name,
        salonName: ctx.salon.name,
        serviceName: ctx.service.name,
        startAt: ctx.booking.start_at,
      });
      await emailSendAndLog({
        bookingId: ctx.booking.id,
        userId: ctx.customer.id,
        kind: 'booking_cancelled.customer',
        to: ctx.customer.email,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
      });
    }
  } catch (err) {
    console.error('[notify] sendBookingCancelled failed', err && err.message ? err.message : err);
  }
}

// Reminder dedup — true when ANY 'sent' notification_log row already exists for
// this booking with a 'booking_reminder.*' kind.
async function reminderAlreadySent(bookingId) {
  const row = await queryOne(
    `SELECT id FROM notification_log
      WHERE booking_id = ?
        AND kind LIKE 'booking_reminder.%'
        AND status = 'sent'
      LIMIT 1`,
    [bookingId]
  );
  return Boolean(row);
}

async function sendBookingReminder(bookingId) {
  try {
    const ctx = await loadBookingContext(bookingId);
    if (!ctx || !ctx.customer) return;
    if (ctx.booking.status !== 'pending' && ctx.booking.status !== 'confirmed') return;
    if (await reminderAlreadySent(bookingId)) return;

    if (ctx.customer.notify_email_reminders) {
      const tmpl = T.bookingReminderCustomer({
        customerName: ctx.customer.name,
        salonName: ctx.salon.name,
        serviceName: ctx.service.name,
        startAt: ctx.booking.start_at,
        bookingId: ctx.booking.id,
        salonAddress: ctx.salon.address,
      });
      await emailSendAndLog({
        bookingId: ctx.booking.id,
        userId: ctx.customer.id,
        kind: 'booking_reminder.customer',
        to: ctx.customer.email,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
      });
    }
    if (ctx.customer.notify_sms_reminders) {
      const body = T.bookingReminderCustomerSms({
        salonName: ctx.salon.name,
        serviceName: ctx.service.name,
        startAt: ctx.booking.start_at,
      });
      await smsSendAndLog({
        bookingId: ctx.booking.id,
        userId: ctx.customer.id,
        kind: 'booking_reminder.customer_sms',
        to: ctx.customer.phone,
        body,
      });
    }
  } catch (err) {
    console.error('[notify] sendBookingReminder failed', err && err.message ? err.message : err);
  }
}

// findBookingsNeedingReminders — bookings whose start_at lands inside the
// 23..25h-from-now window, are still pending/confirmed, and don't have a
// 'booking_reminder.*' notification_log row with status='sent' yet. The
// window is wider than 24h on both sides so an hourly cron with light drift
// still catches every booking exactly once.
async function findBookingsNeedingReminders() {
  return query(
    `SELECT b.id
       FROM bookings b
      WHERE b.status IN ('pending','confirmed')
        AND b.start_at >= DATE_ADD(NOW(), INTERVAL 23 HOUR)
        AND b.start_at <  DATE_ADD(NOW(), INTERVAL 25 HOUR)
        AND NOT EXISTS (
          SELECT 1 FROM notification_log nl
           WHERE nl.booking_id = b.id
             AND nl.kind LIKE 'booking_reminder.%'
             AND nl.status = 'sent'
        )`,
    []
  );
}

// runReminderSweep — convenience entry for an external cron (Hostinger cron,
// GitHub Action). Sends reminders for everything in the upcoming-24h window.
// Safe to invoke repeatedly thanks to the dedup index.
async function runReminderSweep() {
  try {
    const rows = await findBookingsNeedingReminders();
    for (const row of rows) {
      await sendBookingReminder(row.id);
    }
    return { count: rows.length };
  } catch (err) {
    console.error('[notify] runReminderSweep failed', err && err.message ? err.message : err);
    return { count: 0, error: err && err.message ? err.message : 'unknown' };
  }
}

module.exports = {
  sendBookingCreated,
  sendBookingConfirmed,
  sendBookingCancelled,
  sendBookingReminder,
  findBookingsNeedingReminders,
  runReminderSweep,
};
